import { useState, useEffect, useCallback } from "react";
import { Plus, Trash, ChatBubble } from "../../assets/icons";
import { Workflow, Play, RefreshCw } from "lucide-react";
import HermesLogo from "../../components/common/HermesLogo";
import { useI18n } from "../../components/useI18n";

// Souza/JS: n8n bridge — external workflow agents
interface N8nWorkflow {
  id: string | number;
  name: string;
  active: boolean;
  tags?: string[];
}

function N8nPanel(): React.JSX.Element {
  const [workflows, setWorkflows] = useState<N8nWorkflow[]>([]);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState<string | number | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.hermesAPI.listN8nWorkflows();
      setWorkflows(res.workflows || []);
      setConfigured(res.configured);
      setUrl(res.url);
      if (!res.ok && res.error) setError(res.error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleTrigger = useCallback(async (id: string | number, name: string) => {
    setTriggering(id);
    setLastResult(null);
    try {
      const res = await window.hermesAPI.triggerN8nWorkflow(id);
      if (res.ok) {
        setLastResult(`✓ Disparado: "${name}"${res.executionId ? ` (exec ${res.executionId})` : ""}`);
      } else {
        setLastResult(`✗ Erro em "${name}": ${res.error || "desconhecido"}`);
      }
    } finally {
      setTriggering(null);
      setTimeout(() => setLastResult(null), 6000);
    }
  }, []);

  return (
    <div className="n8n-panel">
      <div className="n8n-panel-header">
        <h3>
          <Workflow size={16} strokeWidth={2.2} />
          Agentes externos — n8n
          {url && <span className="n8n-url">· {url}</span>}
        </h3>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={load}
          disabled={loading}
          title="Recarregar lista"
        >
          <RefreshCw size={12} strokeWidth={2.2} className={loading ? "n8n-spin" : ""} />
        </button>
      </div>

      {!configured && (
        <div className="n8n-empty">
          Configure <code>N8N_API_KEY</code> em <code>~/.hermes/.env</code> pra
          ver seus workflows do n8n local. Pegue a chave em n8n →{" "}
          <strong>Settings → API → Create API key</strong>.
        </div>
      )}

      {configured && error && (
        <div className="n8n-error">⚠ {error}</div>
      )}

      {configured && !error && workflows.length === 0 && !loading && (
        <div className="n8n-empty">Nenhum workflow encontrado.</div>
      )}

      {workflows.length > 0 && (
        <div className="n8n-list">
          {workflows.map((wf) => (
            <div key={wf.id} className="n8n-workflow">
              <div className="n8n-workflow-meta">
                <span
                  className={`n8n-dot ${wf.active ? "n8n-dot-active" : "n8n-dot-inactive"}`}
                  title={wf.active ? "Ativo" : "Inativo"}
                />
                <span className="n8n-workflow-name">{wf.name}</span>
                {wf.tags?.map((tag) => (
                  <span key={tag} className="n8n-tag">{tag}</span>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleTrigger(wf.id, wf.name)}
                disabled={triggering === wf.id}
                title="Disparar/ativar workflow"
              >
                <Play size={11} strokeWidth={2.4} />
                {triggering === wf.id ? "Disparando…" : "Disparar"}
              </button>
            </div>
          ))}
        </div>
      )}

      {lastResult && <div className="n8n-result">{lastResult}</div>}
    </div>
  );
}

interface ProfileInfo {
  name: string;
  path: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  provider: string;
  hasEnv: boolean;
  hasSoul: boolean;
  skillCount: number;
  gatewayRunning: boolean;
}

interface AgentsProps {
  activeProfile: string;
  onSelectProfile: (name: string) => void;
  onChatWith: (name: string) => void;
}

function AgentAvatar({ name }: { name: string }): React.JSX.Element {
  if (name === "default") {
    return (
      <div className="agents-card-avatar agents-card-avatar-icon">
        <HermesLogo size={22} />
      </div>
    );
  }
  return (
    <div className="agents-card-avatar">{name.charAt(0).toUpperCase()}</div>
  );
}

function Agents({
  activeProfile,
  onSelectProfile,
  onChatWith,
}: AgentsProps): React.JSX.Element {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [cloneConfig, setCloneConfig] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const loadProfiles = useCallback(async (): Promise<void> => {
    const list = await window.hermesAPI.listProfiles();
    setProfiles(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  async function handleCreate(): Promise<void> {
    const name = newName.trim().toLowerCase();
    if (!name) return;
    setCreating(true);
    setError("");
    const result = await window.hermesAPI.createProfile(name, cloneConfig);
    setCreating(false);
    if (result.success) {
      setShowCreate(false);
      setNewName("");
      loadProfiles();
    } else {
      setError(result.error || t("agents.createFailed"));
    }
  }

  async function handleDelete(name: string): Promise<void> {
    const result = await window.hermesAPI.deleteProfile(name);
    if (result.success) {
      if (activeProfile === name) onSelectProfile("default");
      loadProfiles();
    }
    setConfirmDelete(null);
  }

  async function handleSelect(name: string): Promise<void> {
    await window.hermesAPI.setActiveProfile(name);
    onSelectProfile(name);
    loadProfiles();
  }

  function providerLabel(provider: string): string {
    if (!provider || provider === "auto") return t("agents.auto");
    if (provider === "custom") return t("agents.local");
    if (provider === "claude-oauth") return "Claude CLI AUTH";
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  }

  if (loading) {
    return (
      <div className="agents-container">
        <div className="agents-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="agents-container">
      <div className="agents-header">
        <div>
          <h2 className="agents-title">{t("agents.title")}</h2>
          <p className="agents-subtitle">{t("agents.subtitle")}</p>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setShowCreate(true)}
        >
          <Plus size={14} />
          {t("agents.newAgent")}
        </button>
      </div>

      {showCreate && (
        <div className="agents-create">
          <input
            className="input"
            placeholder={t("agents.namePlaceholder")}
            value={newName}
            onChange={(e) => {
              const v = e.target.value
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, "");
              setNewName(v);
              setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
          <label className="agents-create-clone">
            <input
              type="checkbox"
              checked={cloneConfig}
              onChange={(e) => setCloneConfig(e.target.checked)}
            />
            <span>{t("agents.cloneConfig")}</span>
          </label>
          {error && <div className="agents-create-error">{error}</div>}
          <div className="agents-create-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
            >
              {creating ? t("agents.creating") : t("agents.create")}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setShowCreate(false);
                setError("");
              }}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      <div className="agents-grid">
        {profiles.map((p) => (
          <div
            key={p.name}
            className={`agents-card ${activeProfile === p.name ? "active" : ""}`}
            onClick={() => handleSelect(p.name)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSelect(p.name);
            }}
          >
            <div className="agents-card-header">
              <AgentAvatar name={p.name} />
              <div className="agents-card-info">
                <div className="agents-card-name">{p.name}</div>
                <div className="agents-card-provider">
                  {providerLabel(p.provider)}
                </div>
              </div>
              {activeProfile === p.name && (
                <span className="agents-card-active-badge">
                  {t("agents.active")}
                </span>
              )}
            </div>
            <div className="agents-card-model">
              {p.model ? p.model.split("/").pop() : t("agents.noModel")}
            </div>
            <div className="agents-card-stats">
              <span>{t("agents.skillsCount", { count: p.skillCount })}</span>
              <span className="agents-card-dot" />
              {p.gatewayRunning ? (
                <span className="agents-card-gateway-on">
                  {t("agents.gatewayRunning")}
                </span>
              ) : (
                <span>{t("agents.gatewayOff")}</span>
              )}
            </div>
            <div className="agents-card-footer">
              <button
                className="btn btn-primary btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onChatWith(p.name);
                }}
              >
                <ChatBubble size={13} />
                {t("agents.chat")}
              </button>
              {!p.isDefault &&
                (confirmDelete === p.name ? (
                  <div
                    className="agents-card-confirm-delete"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>{t("agents.deleteConfirm")}</span>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(p.name);
                      }}
                    >
                      {t("agents.yes")}
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete(null);
                      }}
                    >
                      {t("agents.no")}
                    </button>
                  </div>
                ) : (
                  <button
                    className="agents-card-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(p.name);
                    }}
                    title={t("agents.deleteTitle")}
                  >
                    <Trash size={14} />
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>

      {/* Souza/JS: n8n bridge panel */}
      <N8nPanel />
    </div>
  );
}

export default Agents;
