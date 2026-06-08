import { useState, useEffect, useCallback } from "react";
import { Plus, Trash, Search, X } from "../../assets/icons";
import { LogIn, Key, Check as CheckIcon } from "lucide-react";
import { PROVIDERS } from "../../constants";
import { useI18n } from "../../components/useI18n";
import BrandLogo from "../../components/common/BrandLogo";
import { detectProviderFromUrl } from "./detect-provider";
import { useDiscoveredModels } from "../../hooks/useDiscoveredModels";

interface QuickPreset {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  description: string;
  needsAuth?: boolean;
}

const QUICK_PRESETS: QuickPreset[] = [
  {
    id: "codex-mini",
    name: "Codex Mini",
    provider: "openai-codex",
    model: "codex-mini-latest",
    baseUrl: "",
    description: "OpenAI Codex via OAuth — sem chave de API",
  },
  {
    id: "deepseek-flash-proxy",
    name: "deepseek-v4-flash AUTH",
    provider: "custom",
    model: "deepseek-v4-flash",
    baseUrl: "http://localhost:3500/v1",
    description: "DeepSeek via proxy local — use Provedores > DeepsProxy para porta correta",
  },
  {
    id: "deepseek-pro-proxy",
    name: "DeepSeek Pro (DeepsProxy)",
    provider: "custom",
    model: "deepseek-v4-pro",
    baseUrl: "http://localhost:3500/v1",
    description: "DeepSeek Pro via proxy local — maior capacidade",
  },
  {
    id: "claude-sonnet-oauth",
    name: "Claude Sonnet 4.5",
    provider: "claude-oauth",
    model: "claude-sonnet-4-5",
    baseUrl: "",
    description: "Anthropic via conta claude.ai — sem chave de API",
    needsAuth: true,
  },
  {
    id: "claude-opus-oauth",
    name: "Claude Opus 4.5",
    provider: "claude-oauth",
    model: "claude-opus-4-5",
    baseUrl: "",
    description: "Claude Opus via OAuth claude.ai — máxima capacidade",
    needsAuth: true,
  },
];

interface SavedModel {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  createdAt: number;
}

function providerLabelKey(value: string): string {
  return PROVIDERS.options.find((p) => p.value === value)?.label || value;
}

interface ModelsProps {
  visible?: boolean;
}

function Models({ visible }: ModelsProps = {}): React.JSX.Element {
  const { t } = useI18n();
  const [models, setModels] = useState<SavedModel[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [addingPreset, setAddingPreset] = useState<string | null>(null);
  const [claudeAuthState, setClaudeAuthState] = useState<
    "idle" | "detecting" | "installing" | "importing" | "authing" | "waiting_code" | "submitting" | "done" | "error"
  >("idle");
  const [claudeAuthMsg, setClaudeAuthMsg] = useState<string | null>(null);
  const [claudeCodeInput, setClaudeCodeInput] = useState("");

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingModel, setEditingModel] = useState<SavedModel | null>(null);
  const [formName, setFormName] = useState("");
  const [formProvider, setFormProvider] = useState("openrouter");
  const [formModel, setFormModel] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [formError, setFormError] = useState("");
  // Whether the user has manually picked a value from the Provider dropdown
  // for this open of the modal. While false, the dropdown follows whatever
  // detectProviderFromUrl() infers from the Base URL field. Once the user
  // touches the dropdown we stop overriding their choice.
  const [providerTouched, setProviderTouched] = useState(false);
  const [providerAutoFilled, setProviderAutoFilled] = useState(false);

  function resolveCustomEnvKey(url: string): string {
    if (!url) return "CUSTOM_API_KEY";
    if (/openrouter\.ai/i.test(url)) return "OPENROUTER_API_KEY";
    if (/anthropic\.com/i.test(url)) return "ANTHROPIC_API_KEY";
    if (/openai\.com/i.test(url)) return "OPENAI_API_KEY";
    if (/huggingface\.co/i.test(url)) return "HF_TOKEN";
    if (/api\.groq\.com/i.test(url)) return "GROQ_API_KEY";
    if (/api\.deepseek\.com/i.test(url)) return "DEEPSEEK_API_KEY";
    if (/api\.together\.xyz/i.test(url)) return "TOGETHER_API_KEY";
    if (/api\.fireworks\.ai/i.test(url)) return "FIREWORKS_API_KEY";
    if (/api\.cerebras\.ai/i.test(url)) return "CEREBRAS_API_KEY";
    if (/api\.mistral\.ai/i.test(url)) return "MISTRAL_API_KEY";
    if (/api\.perplexity\.ai/i.test(url)) return "PERPLEXITY_API_KEY";
    return "CUSTOM_API_KEY";
  }

  const loadModels = useCallback(async () => {
    const list = await window.hermesAPI.listModels();
    setModels(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  // Re-load whenever the Models pane becomes visible — entries added
  // elsewhere (Providers save → addModel, chat picker → addModel) won't
  // otherwise appear since the component is mounted once and kept alive.
  useEffect(() => {
    if (visible) loadModels();
  }, [visible, loadModels]);

  // Live model discovery for the Add/Edit modal — feeds an HTML
  // <datalist> off the Model ID input.  Pauses when the modal is closed
  // so we don't fire background requests on every keystroke elsewhere.
  const isCustomForm = formProvider === "custom";
  const [discoveryRefresh, setDiscoveryRefresh] = useState(0);
  const discovery = useDiscoveredModels({
    provider: formProvider,
    baseUrl: isCustomForm ? formBaseUrl : undefined,
    apiKey: formApiKey || undefined,
    enabled: showModal && formProvider !== "auto",
    refreshToken: discoveryRefresh,
  });
  const modelDiscoveryListId = "models-modal-discovery";

  async function handleAddPreset(preset: QuickPreset): Promise<void> {
    const alreadyExists = models.some(
      (m) => m.model === preset.model && m.provider === preset.provider,
    );
    if (alreadyExists) return;
    setAddingPreset(preset.id);
    await window.hermesAPI.addModel(preset.name, preset.provider, preset.model, preset.baseUrl);
    await loadModels();
    setAddingPreset(null);
  }

  async function ensureClaudeCli(): Promise<boolean> {
    setClaudeAuthState("detecting");
    const info = await window.hermesAPI.claudeCliDetect();
    if (info?.installed) return true;
    setClaudeAuthState("installing");
    setClaudeAuthMsg("Instalando Claude Code CLI…");
    const result = await window.hermesAPI.claudeCliInstall();
    if (!result?.success) {
      setClaudeAuthState("error");
      setClaudeAuthMsg(result?.error || "Falha ao instalar Claude Code CLI");
      return false;
    }
    return true;
  }

  async function handleClaudeImportInModels(): Promise<void> {
    setClaudeAuthState("importing");
    setClaudeAuthMsg(null);
    try {
      const hasCli = await ensureClaudeCli();
      if (!hasCli) return;
      const result = await window.hermesAPI.claudeOAuthImport();
      if (result?.success) {
        setClaudeAuthState("done");
        setClaudeAuthMsg(null);
      } else {
        setClaudeAuthState("error");
        setClaudeAuthMsg(result?.error || "Não foi possível importar credenciais. Tente 'Autenticar'.");
      }
    } catch (err) {
      setClaudeAuthState("error");
      setClaudeAuthMsg(String(err));
    }
  }

  async function handleClaudeAuthInModels(): Promise<void> {
    setClaudeAuthMsg(null);
    setClaudeCodeInput("");
    const hasCli = await ensureClaudeCli();
    if (!hasCli) return;
    setClaudeAuthState("authing");
    try {
      const result = await window.hermesAPI.claudeOAuthStart(true);
      if (!result) { setClaudeAuthState("error"); return; }
      if (result.status === "imported") {
        setClaudeAuthState("done");
      } else if (result.status === "pkce_started") {
        setClaudeAuthState("waiting_code");
        setClaudeAuthMsg("Browser aberto. Autentique e cole o código abaixo:");
      } else if (result.status === "cli_not_found") {
        setClaudeAuthState("error");
        setClaudeAuthMsg("Claude Code CLI não encontrado após instalação.");
      } else {
        setClaudeAuthState("error");
        setClaudeAuthMsg((result as { message?: string }).message || "Erro ao iniciar autenticação");
      }
    } catch (err) {
      setClaudeAuthState("error");
      setClaudeAuthMsg(String(err));
    }
  }

  async function handleSubmitCode(): Promise<void> {
    if (!claudeCodeInput.trim()) return;
    setClaudeAuthState("submitting");
    try {
      const result = await window.hermesAPI.claudeOAuthSubmitCode(claudeCodeInput.trim());
      if (result?.success) {
        setClaudeAuthState("done");
        setClaudeAuthMsg(null);
        setClaudeCodeInput("");
      } else {
        setClaudeAuthState("error");
        setClaudeAuthMsg(result?.error || "Código inválido ou expirado");
      }
    } catch (err) {
      setClaudeAuthState("error");
      setClaudeAuthMsg(String(err));
    }
  }

  function openAddModal(): void {
    setEditingModel(null);
    setFormName("");
    setFormProvider("openrouter");
    setFormModel("");
    setFormBaseUrl("");
    setFormApiKey("");
    setShowApiKey(false);
    setFormError("");
    setProviderTouched(false);
    setProviderAutoFilled(false);
    setShowModal(true);
  }

  function openEditModal(m: SavedModel): void {
    setEditingModel(m);
    setFormName(m.name);
    setFormProvider(m.provider);
    setFormModel(m.model);
    setFormBaseUrl(m.baseUrl);
    setFormApiKey("");
    setShowApiKey(false);
    setFormError("");
    // Editing an existing entry — respect the saved provider, don't auto-overwrite it.
    setProviderTouched(true);
    setProviderAutoFilled(false);
    setShowModal(true);
  }

  function closeModal(): void {
    setShowModal(false);
    setEditingModel(null);
    setFormError("");
    setProviderTouched(false);
    setProviderAutoFilled(false);
  }

  // Auto-detect provider from base URL while the modal is open and the user
  // hasn't manually picked a provider yet. Detection runs on every URL
  // change so backspacing the URL also clears the auto-fill flag.
  useEffect(() => {
    if (!showModal || providerTouched) {
      if (!showModal) setProviderAutoFilled(false);
      return;
    }
    const detected = detectProviderFromUrl(formBaseUrl);
    if (detected && detected !== formProvider) {
      setFormProvider(detected);
      setProviderAutoFilled(true);
    } else if (!detected && providerAutoFilled) {
      // URL no longer matches; drop the badge but keep whatever's selected.
      setProviderAutoFilled(false);
    }
  }, [
    formBaseUrl,
    showModal,
    providerTouched,
    formProvider,
    providerAutoFilled,
  ]);

  async function handleSave(): Promise<void> {
    const name = formName.trim();
    const model = formModel.trim();
    if (!name || !model) {
      setFormError(t("models.nameRequired"));
      return;
    }
    setFormError("");

    if (editingModel) {
      await window.hermesAPI.updateModel(editingModel.id, {
        name,
        provider: formProvider,
        model,
        baseUrl: formBaseUrl.trim(),
      });
    } else {
      await window.hermesAPI.addModel(
        name,
        formProvider,
        model,
        formBaseUrl.trim(),
      );
    }

    if (formApiKey.trim() && formProvider === "custom") {
      const envKey = resolveCustomEnvKey(formBaseUrl.trim());
      await window.hermesAPI.setEnv(envKey, formApiKey.trim());
    }

    closeModal();
    await loadModels();
  }

  async function handleDelete(id: string): Promise<void> {
    await window.hermesAPI.removeModel(id);
    setConfirmDelete(null);
    await loadModels();
  }

  const filtered = models.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.name.toLowerCase().includes(q) ||
      m.model.toLowerCase().includes(q) ||
      m.provider.toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="settings-container">
        <h1 className="settings-header">{t("models.title")}</h1>
        <div className="models-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="settings-container">
      <div className="models-header">
        <div>
          <h1 className="settings-header models-title-tight">
            {t("models.title")}
          </h1>
          <p className="models-subtitle">{t("models.subtitle")}</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openAddModal}>
          <Plus size={14} />
          {t("models.addModel")}
        </button>
      </div>

      {/* Quick-add presets */}
      <div className="models-presets">
        <div className="models-presets-label">Presets rápidos</div>
        <div className="models-presets-grid">
          {QUICK_PRESETS.map((preset) => {
            const alreadyAdded = models.some(
              (m) => m.model === preset.model && m.provider === preset.provider,
            );
            return (
              <div key={preset.id} className={`models-preset-card${alreadyAdded ? " added" : ""}`}>
                <div className="models-preset-head">
                  <BrandLogo provider={preset.provider} modelId={preset.model} size={18} />
                  <span className="models-preset-name">{preset.name}</span>
                </div>
                <p className="models-preset-desc">{preset.description}</p>
                {preset.needsAuth && claudeAuthState !== "done" && (
                  <>
                    <div className="models-preset-auth-row">
                      <button
                        className="btn btn-sm btn-secondary models-preset-btn"
                        onClick={handleClaudeImportInModels}
                        disabled={["detecting","installing","importing","authing","submitting","waiting_code"].includes(claudeAuthState)}
                        title="Importar credenciais do Claude Code CLI já autenticado"
                      >
                        {claudeAuthState === "importing"
                          ? "Importando…"
                          : claudeAuthState === "detecting" || claudeAuthState === "installing"
                            ? "Verificando CLI…"
                            : <><Key size={12} /> Importar</>}
                      </button>
                      <button
                        className="btn btn-sm btn-secondary models-preset-btn"
                        onClick={handleClaudeAuthInModels}
                        disabled={["detecting","installing","importing","authing","submitting","waiting_code"].includes(claudeAuthState)}
                        title="Autenticar via claude auth login --claudeai"
                      >
                        {claudeAuthState === "authing"
                          ? "Abrindo browser…"
                          : claudeAuthState === "detecting"
                            ? "Verificando CLI…"
                            : claudeAuthState === "installing"
                              ? "Instalando CLI…"
                              : <><LogIn size={12} /> Autenticar</>}
                      </button>
                    </div>
                    {claudeAuthState === "waiting_code" && (
                      <div className="models-preset-code-row">
                        <p className="models-preset-code-hint">
                          {claudeAuthMsg || "Cole o código exibido na página do browser:"}
                        </p>
                        <div className="models-preset-code-input-row">
                          <input
                            className="input models-preset-code-input"
                            type="text"
                            value={claudeCodeInput}
                            onChange={(e) => setClaudeCodeInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSubmitCode()}
                            placeholder="Cole o código aqui…"
                            autoFocus
                          />
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={handleSubmitCode}
                            disabled={!claudeCodeInput.trim()}
                          >
                            Confirmar
                          </button>
                        </div>
                      </div>
                    )}
                    {claudeAuthMsg && claudeAuthState === "error" && (
                      <p className="models-preset-auth-error">{claudeAuthMsg}</p>
                    )}
                    {claudeAuthMsg && claudeAuthState === "installing" && (
                      <p className="models-preset-auth-hint">{claudeAuthMsg}</p>
                    )}
                  </>
                )}
                {preset.needsAuth && claudeAuthState === "done" && (
                  <p className="models-preset-auth-success"><CheckIcon size={12} /> Autenticado com sucesso</p>
                )}
                <button
                  className="btn btn-sm btn-secondary models-preset-btn"
                  onClick={() => handleAddPreset(preset)}
                  disabled={alreadyAdded || addingPreset === preset.id}
                >
                  {alreadyAdded
                    ? "Adicionado"
                    : addingPreset === preset.id
                      ? "Adicionando…"
                      : <><Plus size={12} /> Adicionar</>}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {models.length > 0 && (
        <div className="models-search">
          <Search size={14} />
          <input
            className="models-search-input"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("models.searchPlaceholder")}
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="models-empty">
          {models.length === 0 ? (
            <>
              <p className="models-empty-text">{t("models.empty")}</p>
              <p className="models-empty-hint">{t("models.emptyHint")}</p>
            </>
          ) : (
            <p className="models-empty-text">{t("models.noMatch")}</p>
          )}
        </div>
      ) : (
        <div className="models-grid">
          {filtered.map((m) => (
            <div
              key={m.id}
              className="models-card"
              onClick={() => openEditModal(m)}
            >
              <div className="models-card-header">
                <div className="models-card-title">
                  <BrandLogo
                    provider={m.provider}
                    modelId={m.model}
                    size={20}
                  />
                  <div className="models-card-name">{m.name}</div>
                </div>
                <span className="models-card-provider">
                  {t(providerLabelKey(m.provider))}
                </span>
              </div>
              <div className="models-card-model">{m.model}</div>
              {m.baseUrl && <div className="models-card-url">{m.baseUrl}</div>}
              <div className="models-card-footer">
                {confirmDelete === m.id ? (
                  <div
                    className="models-card-confirm"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>{t("models.deleteConfirm")}</span>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger-text"
                      onClick={() => handleDelete(m.id)}
                    >
                      {t("models.yes")}
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => setConfirmDelete(null)}
                    >
                      {t("models.no")}
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn-ghost models-card-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(m.id);
                    }}
                    title={t("models.deleteModelTitle")}
                  >
                    <Trash size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="models-modal-overlay" onClick={closeModal}>
          <div className="models-modal" onClick={(e) => e.stopPropagation()}>
            <div className="models-modal-header">
              <h2 className="models-modal-title">
                {editingModel ? t("models.editModel") : t("models.addModel")}
              </h2>
              <button
                type="button"
                className="btn-ghost"
                onClick={closeModal}
                aria-label={t("common.close")}
                title={t("common.close")}
              >
                <X size={18} />
              </button>
            </div>

            <div className="models-modal-body">
              <div className="models-modal-field">
                <label className="models-modal-label">
                  {t("models.displayName")}
                </label>
                <input
                  className="input"
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={t("models.namePlaceholder")}
                  autoFocus
                />
              </div>

              <div className="models-modal-field">
                <label
                  className="models-modal-label"
                  htmlFor="model-form-provider"
                >
                  {t("common.provider")}
                  {providerAutoFilled && !providerTouched && (
                    <span className="models-modal-auto-badge">
                      &nbsp;· auto-detected from base URL
                    </span>
                  )}
                </label>
                <select
                  id="model-form-provider"
                  className="input"
                  value={formProvider}
                  onChange={(e) => {
                    setFormProvider(e.target.value);
                    setProviderTouched(true);
                    setProviderAutoFilled(false);
                  }}
                  aria-label={t("common.provider")}
                >
                  {PROVIDERS.options.map((p) => (
                    <option key={p.value} value={p.value}>
                      {t(p.label)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="models-modal-field">
                <label className="models-modal-label">
                  {t("models.modelId")}
                </label>
                <div className="settings-model-row">
                  <input
                    className="input"
                    type="text"
                    value={formModel}
                    onChange={(e) => setFormModel(e.target.value)}
                    placeholder={t("models.modelIdPlaceholder")}
                    list={
                      discovery.models.length > 0
                        ? modelDiscoveryListId
                        : undefined
                    }
                    autoComplete="off"
                  />
                  {discovery.status !== "unsupported" &&
                    discovery.status !== "idle" && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setDiscoveryRefresh((n) => n + 1)}
                        disabled={discovery.status === "loading"}
                        title={t("settings.refreshModels")}
                      >
                        ↻
                      </button>
                    )}
                </div>
                {discovery.models.length > 0 && (
                  <datalist id={modelDiscoveryListId}>
                    {discovery.models.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                )}
                {discovery.status !== "idle" &&
                  discovery.status !== "unsupported" && (
                    <span className="models-modal-hint">
                      {discovery.status === "loading"
                        ? t("settings.discoveringModels")
                        : discovery.status === "ok"
                          ? t("settings.discoveredCount", {
                              count: discovery.models.length,
                            })
                          : discovery.status === "no-key"
                            ? t("settings.discoveryNoKey")
                            : discovery.status === "error"
                              ? t("settings.discoveryError")
                              : ""}
                    </span>
                  )}
              </div>

              <div className="models-modal-field">
                <label className="models-modal-label">
                  {t("common.baseUrl")} ({t("common.optional")})
                </label>
                <input
                  className="input"
                  type="text"
                  value={formBaseUrl}
                  onChange={(e) => setFormBaseUrl(e.target.value)}
                  placeholder={t("models.baseUrlPlaceholder")}
                />
                <span className="models-modal-hint">
                  {t("models.customProviderHint")}
                </span>
              </div>

              {formProvider === "custom" && (
                <div className="models-modal-field">
                  <label className="models-modal-label">
                    {t("models.apiKeyLabel")} ({t("common.optional")})
                  </label>
                  <div className="setup-input-group">
                    <input
                      className="input"
                      type={showApiKey ? "text" : "password"}
                      value={formApiKey}
                      onChange={(e) => setFormApiKey(e.target.value)}
                      placeholder="sk-..."
                    />
                    <button
                      className="setup-toggle-visibility"
                      onClick={() => setShowApiKey(!showApiKey)}
                      type="button"
                    >
                      {showApiKey ? t("common.hide") : t("common.show")}
                    </button>
                  </div>
                  <span className="models-modal-hint">
                    {t("models.apiKeyHint")}
                  </span>
                </div>
              )}

              {formError && <div className="models-error">{formError}</div>}
            </div>

            <div className="models-modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={closeModal}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleSave}>
                {editingModel ? t("models.update") : t("models.addModel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Models;
