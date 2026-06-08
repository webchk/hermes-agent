import { useState, useEffect, useRef, useCallback } from "react";
import { SETTINGS_SECTIONS, PROVIDERS } from "../../constants";
import { useI18n } from "../../components/useI18n";
import BrandLogo from "../../components/common/BrandLogo";
import { useDiscoveredModels } from "../../hooks/useDiscoveredModels";
import { RefreshCw, Square, Play, LogIn, Download, Check, LogOut, Key, UserCheck } from "lucide-react";

type DspState =
  | "checking"
  | "not_installed"
  | "installing"
  | "installed_stopped"
  | "starting"
  | "authenticating"
  | "running";

function Providers({
  profile,
  visible,
}: {
  profile?: string;
  visible?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();

  // Env / API keys
  const [env, setEnv] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  // Model config
  const [modelProvider, setModelProvider] = useState("auto");
  const [modelName, setModelName] = useState("");
  const [modelBaseUrl, setModelBaseUrl] = useState("");
  const [modelSaved, setModelSaved] = useState(false);
  const modelLoaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Credential pool
  const [credPool, setCredPool] = useState<
    Record<string, Array<{ key: string; label: string }>>
  >({});
  const [poolProvider, setPoolProvider] = useState("");
  const [poolNewKey, setPoolNewKey] = useState("");
  const [poolNewLabel, setPoolNewLabel] = useState("");

  // DeepsProxy lifecycle
  const [dspState, setDspState] = useState<DspState>("checking");
  const [dspLog, setDspLog] = useState<string[]>([]);
  const [dspActivated, setDspActivated] = useState(false);
  const [hasAuthenticated, setHasAuthenticated] = useState(
    () => localStorage.getItem("dsp_authenticated") === "true",
  );
  const [tokenPrefix, setTokenPrefix] = useState<string>("");
  const [dspPort, setDspPort] = useState<number>(3500);
  const dspLogRef = useRef<HTMLDivElement | null>(null);

  // Manual token injection + credential pool
  const [manualTokenInput, setManualTokenInput] = useState("");
  const [poolStatus, setPoolStatus] = useState<{
    count: number;
    currentIndex: number;
    prefixes: string[];
  }>({ count: 0, currentIndex: 0, prefixes: [] });

  // Headless toggle — stored in localStorage, passed as env var on proxy start
  const [dspHeadless, setDspHeadless] = useState<boolean>(
    () => localStorage.getItem("dsp_headless") !== "false",
  );

  // Claude.ai OAuth state
  type ClaudeOAuthState = "idle" | "detecting" | "installing" | "importing" | "authenticating" | "waiting_code" | "submitting" | "waiting" | "authenticated" | "error";
  const [claudeOAuthState, setClaudeOAuthState] = useState<ClaudeOAuthState>("idle");
  const [claudeOAuthCredential, setClaudeOAuthCredential] = useState<{
    email: string | null;
    tokenPrefix: string;
    expiresAt: number | null;
  } | null>(null);
  const [claudeOAuthError, setClaudeOAuthError] = useState<string | null>(null);
  const [claudeCodeInput, setClaudeCodeInput] = useState("");

  // Per-key debounce timers for env auto-save on change. Previously env
  // values were persisted only on input blur, so users who clicked the
  // model dropdown (triggering the model-config auto-save) without first
  // blurring the API key input lost their typed key — config.yaml
  // updated but .env didn't. Issue #236. The on-blur handler stays as a
  // "flush immediately" fast path; the debounce here catches the
  // change-but-no-blur case.
  const envSaveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  // Mirror of `env` state, kept in a ref so the unmount cleanup can read
  // the latest value when flushing pending debounces (a closure over
  // `env` directly would capture a stale snapshot).
  const envRef = useRef<Record<string, string>>({});

  const loadConfig = useCallback(async (): Promise<void> => {
    const [envData, mc, pool] = await Promise.all([
      window.hermesAPI.getEnv(profile),
      window.hermesAPI.getModelConfig(profile),
      window.hermesAPI.getCredentialPool(),
    ]);
    setEnv(envData);
    setModelProvider(mc.provider);
    setModelName(mc.model);
    setModelBaseUrl(mc.baseUrl);
    setCredPool(pool);

    requestAnimationFrame(() => {
      modelLoaded.current = true;
    });
  }, [profile]);

  useEffect(() => {
    modelLoaded.current = false;
    loadConfig();
  }, [loadConfig]);

  // Refresh model config when the screen becomes visible
  useEffect(() => {
    if (!visible) return;
    (async (): Promise<void> => {
      const mc = await window.hermesAPI.getModelConfig(profile);
      modelLoaded.current = false;
      setModelProvider(mc.provider);
      setModelName(mc.model);
      setModelBaseUrl(mc.baseUrl);
      requestAnimationFrame(() => {
        modelLoaded.current = true;
      });
    })();
  }, [visible, profile]);

  // DeepsProxy lifecycle
  const addDspLog = useCallback((line: string): void => {
    setDspLog((prev) => [...prev.slice(-200), line]);
    requestAnimationFrame(() => {
      if (dspLogRef.current) {
        dspLogRef.current.scrollTop = dspLogRef.current.scrollHeight;
      }
    });
  }, []);

  const refreshDspState = useCallback(async (): Promise<void> => {
    setDspState("checking");
    const s = await window.hermesAPI.deepsProxyStatus();
    if (s.serverRunning) setDspState("running");
    else if (s.processRunning || s.starting) setDspState("starting");
    else if (s.installed) setDspState("installed_stopped");
    else setDspState("not_installed");
  }, []);

  useEffect(() => { refreshDspState(); }, [refreshDspState]);
  useEffect(() => { if (visible) refreshDspState(); }, [visible, refreshDspState]);

  // Carregar status do Claude OAuth
  useEffect(() => {
    window.hermesAPI.claudeOAuthStatus().then((s) => {
      const status = s as { authenticated: boolean; credential: { email: string | null; tokenPrefix: string; expiresAt: number | null } | null };
      if (status.authenticated && status.credential) {
        setClaudeOAuthCredential(status.credential);
        setClaudeOAuthState("authenticated");
      }
    }).catch(() => {});
  }, []);

  // Subscribe to log events from main process
  useEffect(() => {
    const offInstall = window.hermesAPI.onDeepsProxyInstallLog(addDspLog);
    const offLog = window.hermesAPI.onDeepsProxyLog(addDspLog);
    const offLoginComplete = window.hermesAPI.onDeepsProxyLoginComplete((port) => {
      setDspPort(port);
      setDspState("starting");
    });
    return () => { offInstall(); offLog(); offLoginComplete(); };
  }, [addDspLog]);

  // Fetch current proxy port on mount
  useEffect(() => {
    window.hermesAPI.deepsProxyGetPort().then(setDspPort).catch(() => {});
  }, []);

  // Poll server status when process is starting
  useEffect(() => {
    if (dspState !== "starting") return;
    const interval = setInterval(async () => {
      const s = await window.hermesAPI.deepsProxyStatus();
      if (s.serverRunning) {
        setDspState("running");
        clearInterval(interval);
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [dspState]);

  // Poll /auth-status and /pool when proxy is running
  useEffect(() => {
    if (dspState !== "running" && dspState !== "starting") {
      setTokenPrefix("");
      return;
    }
    const fetchStatus = async () => {
      try {
        const [authRes, poolRes] = await Promise.all([
          fetch(`http://localhost:${dspPort}/auth-status`),
          fetch(`http://localhost:${dspPort}/pool`),
        ]);
        if (authRes.ok) {
          const data = await authRes.json();
          if (data.hasToken && data.tokenPrefix) setTokenPrefix(data.tokenPrefix as string);
        }
        if (poolRes.ok) {
          const data = await poolRes.json();
          setPoolStatus(data);
        }
      } catch { /* proxy may not be ready yet */ }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [dspState, dspPort]);

  async function handleDspInstall(): Promise<void> {
    setDspState("installing");
    setDspLog([]);
    await window.hermesAPI.deepsProxyInstall();
    await refreshDspState();
  }

  async function handleDspLogin(): Promise<void> {
    setDspState("authenticating");
    await window.hermesAPI.deepsProxyLogin();
    await refreshDspState();
  }

  async function handleDspCompleteLogin(): Promise<void> {
    setHasAuthenticated(true);
    localStorage.setItem("dsp_authenticated", "true");
    setDspState("starting");
    await window.hermesAPI.deepsProxyCompleteLogin();
  }

  async function handleDspStart(): Promise<void> {
    setDspState("starting");
    await window.hermesAPI.deepsProxyStart();
  }

  async function handleDspStop(): Promise<void> {
    await window.hermesAPI.deepsProxyStop();
    await refreshDspState();
  }

  async function handleSetManualToken(): Promise<void> {
    if (!manualTokenInput.trim()) return;
    try {
      const res = await fetch(`http://localhost:${dspPort}/set-token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: manualTokenInput.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setPoolStatus(data.pool || poolStatus);
        setManualTokenInput("");
      }
    } catch { /* proxy not running */ }
  }

  async function handleRemovePoolToken(index: number): Promise<void> {
    try {
      const res = await fetch(`http://localhost:${dspPort}/pool/${index}`, {
        method: "DELETE",
      });
      if (res.ok) {
        const data = await res.json();
        setPoolStatus({ count: data.count, currentIndex: data.currentIndex, prefixes: data.prefixes });
      }
    } catch { /* proxy not running */ }
  }

  async function handleReloadAuth(): Promise<void> {
    try {
      await fetch(`http://localhost:${dspPort}/reload-auth`);
    } catch { /* proxy not running */ }
  }

  async function handleToggleHeadless(): Promise<void> {
    const next = !dspHeadless;
    setDspHeadless(next);
    localStorage.setItem("dsp_headless", String(next));
    await window.hermesAPI.deepsProxySetHeadless(next).catch(() => {});
    if (dspState === "running") {
      await handleDspStop();
      await handleDspStart();
    }
  }

  async function handleActivateDeepsProxy(): Promise<void> {
    const port = await window.hermesAPI.deepsProxyGetPort().catch(() => dspPort);
    const baseUrl = `http://localhost:${port}/v1`;
    modelLoaded.current = false;
    setModelProvider("custom");
    setModelBaseUrl(baseUrl);
    setModelName("deepseek-v4-flash");
    requestAnimationFrame(() => { modelLoaded.current = true; });
    await window.hermesAPI.setModelConfig("custom", "deepseek-v4-flash", baseUrl, profile);
    await window.hermesAPI.addModel("deepseek-v4-flash AUTH", "custom", "deepseek-v4-flash", baseUrl).catch(() => {});
    // Notify Chat screen to reload its model config in real-time
    window.dispatchEvent(new CustomEvent("hermes:model-changed"));
    setDspActivated(true);
    setTimeout(() => setDspActivated(false), 2500);
  }

  // Auto-save the active model config (config.yaml) — debounced 500 ms so
  // typing in the Model field still feels responsive.
  const saveModelConfig = useCallback(async () => {
    if (!modelLoaded.current) return;
    await window.hermesAPI.setModelConfig(
      modelProvider,
      modelName,
      modelBaseUrl,
      profile,
    );
    setModelSaved(true);
    setTimeout(() => setModelSaved(false), 2000);
  }, [modelProvider, modelName, modelBaseUrl, profile]);

  useEffect(() => {
    if (!modelLoaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveModelConfig();
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [modelProvider, modelName, modelBaseUrl, saveModelConfig]);

  // Separately, persist the (provider, model) pair to the Models library
  // — but only after the user has been idle long enough that they've
  // plausibly finished typing the model name.  The active-save debounce
  // at 500 ms used to call `addModel` on every keystroke pause, leaving
  // dead intermediate entries ("deepseek-reaso", "deepseek-reason", …)
  // every time someone typed slowly.  2 s wait is enough for almost any
  // real edit while still landing the entry without an explicit Save click.
  const modelLibTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!modelLoaded.current) return;
    if (!modelName.trim()) return;
    if (modelLibTimer.current) clearTimeout(modelLibTimer.current);
    modelLibTimer.current = setTimeout(() => {
      const displayName = modelName.split("/").pop() || modelName;
      window.hermesAPI
        .addModel(displayName, modelProvider, modelName, modelBaseUrl)
        .catch(() => {
          /* non-fatal — library write is best-effort */
        });
    }, 2000);
    return () => {
      if (modelLibTimer.current) clearTimeout(modelLibTimer.current);
    };
  }, [modelProvider, modelName, modelBaseUrl]);

  async function handleBlur(key: string): Promise<void> {
    // Cancel any pending debounced save for this key — the blur handler
    // is a faster flush path with the "Saved" indicator.
    const pending = envSaveTimers.current.get(key);
    if (pending) {
      clearTimeout(pending);
      envSaveTimers.current.delete(key);
    }
    const value = env[key] || "";
    await window.hermesAPI.setEnv(key, value, profile);
    setSavedKey(key);
    setTimeout(() => setSavedKey(null), 2000);
  }

  function handleChange(key: string, value: string): void {
    setEnv((prev) => ({ ...prev, [key]: value }));

    // Persist the typed value on change (debounced 400ms) so users who
    // navigate away — or trigger the model-config auto-save by changing
    // the provider dropdown — don't lose what they typed if they never
    // explicitly blurred the input. Matches the model config's
    // auto-save behavior; resolves the asymmetry behind issue #236.
    const pending = envSaveTimers.current.get(key);
    if (pending) clearTimeout(pending);
    const timer = setTimeout(() => {
      envSaveTimers.current.delete(key);
      void window.hermesAPI.setEnv(key, value, profile);
    }, 400);
    envSaveTimers.current.set(key, timer);
  }

  // Keep envRef in sync with the latest env state so the unmount
  // cleanup below can read it without stale-closure issues.
  useEffect(() => {
    envRef.current = env;
  }, [env]);

  useEffect(() => {
    // On unmount, flush any pending debounced env writes synchronously
    // (fire-and-forget — the IPC handler in the main process completes
    // regardless of React lifecycle). Without this, typing an API key
    // and immediately navigating away within the debounce window would
    // lose the typed value, exactly the original bug.
    const timers = envSaveTimers.current;
    return () => {
      for (const [key, timer] of timers) {
        clearTimeout(timer);
        void window.hermesAPI.setEnv(key, envRef.current[key] || "", profile);
      }
      timers.clear();
    };
  }, [profile]);

  async function handleAddPoolKey(): Promise<void> {
    if (!poolProvider || !poolNewKey.trim()) return;
    const existing = credPool[poolProvider] || [];
    const entries = [
      ...existing,
      {
        key: poolNewKey.trim(),
        label: poolNewLabel.trim() || `Key ${existing.length + 1}`,
      },
    ];
    await window.hermesAPI.setCredentialPool(poolProvider, entries);
    setCredPool((prev) => ({ ...prev, [poolProvider]: entries }));
    setPoolNewKey("");
    setPoolNewLabel("");
  }

  async function handleRemovePoolKey(
    provider: string,
    index: number,
  ): Promise<void> {
    const entries = [...(credPool[provider] || [])];
    entries.splice(index, 1);
    await window.hermesAPI.setCredentialPool(provider, entries);
    setCredPool((prev) => ({ ...prev, [provider]: entries }));
  }

  function toggleVisibility(key: string): void {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ── Claude OAuth handlers ───────────────────────────────

  async function ensureClaudeCli(): Promise<boolean> {
    setClaudeOAuthError(null);
    setClaudeOAuthState("detecting");
    const detect = await window.hermesAPI.claudeCliDetect() as { installed: boolean; path?: string };
    if (detect.installed) return true;
    setClaudeOAuthState("installing");
    const install = await window.hermesAPI.claudeCliInstall() as { success: boolean; error?: string };
    if (!install.success) {
      setClaudeOAuthError(install.error ?? "Falha ao instalar Claude Code CLI");
      setClaudeOAuthState("error");
      return false;
    }
    return true;
  }

  async function handleClaudeOAuthImport(): Promise<void> {
    setClaudeOAuthError(null);
    const ok = await ensureClaudeCli();
    if (!ok) return;
    setClaudeOAuthState("importing");
    try {
      const result = await window.hermesAPI.claudeOAuthImport() as
        | { success: true; credential: { email: string | null; tokenPrefix: string; expiresAt: number | null } }
        | { success: false; error: string };
      if (result.success) {
        setClaudeOAuthCredential(result.credential);
        setClaudeOAuthState("authenticated");
      } else {
        setClaudeOAuthError(result.error);
        setClaudeOAuthState("error");
      }
    } catch (err) {
      setClaudeOAuthError(String(err));
      setClaudeOAuthState("error");
    }
  }

  async function handleClaudeOAuthLogin(): Promise<void> {
    setClaudeOAuthError(null);
    const ok = await ensureClaudeCli();
    if (!ok) return;
    setClaudeOAuthState("authenticating");
    try {
      const result = await window.hermesAPI.claudeOAuthStart(true) as
        | { status: "imported"; credential: { email: string | null; tokenPrefix: string; expiresAt: number | null } }
        | { status: "pkce_started"; authUrl: string }
        | { status: "cli_not_found" }
        | { status: "error"; message: string };

      if (result.status === "imported") {
        setClaudeOAuthCredential(result.credential);
        setClaudeOAuthState("authenticated");
      } else if (result.status === "pkce_started") {
        setClaudeCodeInput("");
        setClaudeOAuthState("waiting_code");
      } else if (result.status === "cli_not_found") {
        setClaudeOAuthError("Claude Code CLI não encontrado após instalação");
        setClaudeOAuthState("error");
      } else {
        setClaudeOAuthError(result.message);
        setClaudeOAuthState("error");
      }
    } catch (err) {
      setClaudeOAuthError(String(err));
      setClaudeOAuthState("error");
    }
  }

  async function handleClaudeOAuthSubmitCode(): Promise<void> {
    const code = claudeCodeInput.trim();
    if (!code) return;
    setClaudeOAuthState("submitting");
    setClaudeOAuthError(null);
    try {
      const result = await window.hermesAPI.claudeOAuthSubmitCode(code) as {
        success: boolean;
        credential?: { email: string | null; tokenPrefix: string; expiresAt: number | null };
        error?: string;
      };
      if (result.success && result.credential) {
        setClaudeOAuthCredential(result.credential);
        setClaudeOAuthState("authenticated");
      } else if (result.success) {
        setClaudeOAuthState("authenticated");
      } else {
        setClaudeOAuthError(result.error ?? "Falha ao enviar código");
        setClaudeOAuthState("error");
      }
    } catch (err) {
      setClaudeOAuthError(String(err));
      setClaudeOAuthState("error");
    }
  }

  async function handleClaudeOAuthLogout(): Promise<void> {
    await window.hermesAPI.claudeOAuthLogout();
    setClaudeOAuthCredential(null);
    setClaudeOAuthState("idle");
    setClaudeOAuthError(null);
  }

  const isCustomProvider = modelProvider === "custom";

  // Live model discovery: fetch the provider's /v1/models list and feed
  // it into a datalist that powers the Model field's autocomplete.  Only
  // runs once the Providers tab is visible so we don't fire on every
  // background remount.
  const [discoveryRefresh, setDiscoveryRefresh] = useState(0);
  const discovery = useDiscoveredModels({
    provider: modelProvider,
    baseUrl: isCustomProvider ? modelBaseUrl : undefined,
    profile,
    enabled: !!visible && modelProvider !== "auto",
    refreshToken: discoveryRefresh,
  });
  const discoveryListId = "provider-model-discovery";

  return (
    <div className="settings-container">
      <h1 className="settings-header">{t("providers.title")}</h1>
      <p className="models-subtitle" style={{ marginBottom: 16 }}>
        {t("providers.subtitle")}
      </p>

      <div className="settings-section">
        <div className="settings-section-title">
          {t("common.model")}
          {modelSaved && (
            <span className="settings-saved" style={{ marginLeft: 8 }}>
              {t("common.saved")}
            </span>
          )}
        </div>

        <div className="settings-field">
          <label className="settings-field-label">{t("common.provider")}</label>
          <div className="settings-provider-row">
            <BrandLogo provider={modelProvider} modelId={modelName} size={20} />
            <select
              className="input settings-select"
              value={modelProvider}
              onChange={(e) => {
                const v = e.target.value;
                setModelProvider(v);
                if (v === "custom") {
                  // Seed a local-LLM placeholder only when the field is empty
                  // (don't clobber an existing custom URL the user has typed).
                  if (!modelBaseUrl) {
                    setModelBaseUrl("http://localhost:1234/v1");
                  }
                } else {
                  // Switching to a named provider — its base_url is hardcoded
                  // by the gateway, and a stale URL from a prior provider
                  // would either be ignored (best case) or misroute (worst).
                  setModelBaseUrl("");
                }
              }}
            >
              {PROVIDERS.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.label)}
                </option>
              ))}
            </select>
          </div>
          <div className="settings-field-hint">
            {isCustomProvider
              ? t("settings.customProviderHint")
              : t("settings.providerHint")}
          </div>
        </div>

        {/* Inline Claude OAuth widget — aparece quando provider = claude-oauth */}
        {modelProvider === "claude-oauth" && (
          <div className="dsp-inline" style={{ marginBottom: 8 }}>
            <div className="dsp-inline-status">
              <span className={`dsp-dot dsp-dot--sm${claudeOAuthState === "authenticated" ? " running" : claudeOAuthState === "authenticating" || claudeOAuthState === "waiting" || claudeOAuthState === "importing" ? " pending" : " stopped"}`} />
              <span className="dsp-inline-label">
                Claude.ai OAuth ·{" "}
                {{
                  idle: "não conectado",
                  importing: "importando…",
                  authenticating: "abrindo login…",
                  waiting: "aguardando…",
                  authenticated: claudeOAuthCredential?.email ?? "conectado",
                  error: `erro: ${claudeOAuthError ?? ""}`,
                }[claudeOAuthState]}
              </span>
              {claudeOAuthState === "authenticated" && claudeOAuthCredential && (
                <span className="dsp-token-badge" style={{ marginLeft: 6 }}>
                  <span className="dsp-token-value">{claudeOAuthCredential.tokenPrefix}</span>
                </span>
              )}
            </div>
            <div className="dsp-inline-actions">
              {(claudeOAuthState === "idle" || claudeOAuthState === "error") && (
                <>
                  <button className="btn btn-sm btn-secondary" onClick={handleClaudeOAuthImport} title="Importar credenciais do Claude Code CLI (~/.claude.json)">
                    <Key size={11} />
                    Importar do Claude Code
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={handleClaudeOAuthLogin}>
                    <LogIn size={11} />
                    Conectar com Claude.ai
                  </button>
                </>
              )}
              {(claudeOAuthState === "importing" || claudeOAuthState === "authenticating" || claudeOAuthState === "waiting") && (
                <span className="dsp-inline-hint">aguardando…</span>
              )}
              {claudeOAuthState === "authenticated" && (
                <button className="btn btn-sm btn-secondary" onClick={handleClaudeOAuthLogout}>
                  <LogOut size={11} />
                  Desconectar
                </button>
              )}
            </div>
          </div>
        )}

        <div className="settings-field">
          <label className="settings-field-label">{t("common.model")}</label>
          <div className="settings-model-row">
            <input
              className="input"
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder={t("settings.modelNamePlaceholder")}
              list={discovery.models.length > 0 ? discoveryListId : undefined}
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
            <datalist id={discoveryListId}>
              {discovery.models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}
          <div className="settings-field-hint">
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
                    : t("settings.modelHint")}
          </div>
        </div>

        {isCustomProvider && (
          <div className="settings-field">
            <label className="settings-field-label">
              {t("common.baseUrl")}
            </label>
            <input
              className="input"
              type="text"
              value={modelBaseUrl}
              onChange={(e) => setModelBaseUrl(e.target.value)}
              placeholder={t("settings.modelBaseUrlPlaceholder")}
            />
            <div className="settings-field-hint">
              {t("settings.customBaseUrlHint")}
            </div>
          </div>
        )}

        {/* Inline DeepsProxy widget — aparece quando base URL aponta para o proxy local */}
        {isCustomProvider && modelBaseUrl.includes(`localhost:${dspPort}`) && (
          <div className="dsp-inline">
            <div className="dsp-inline-status">
              <span className={`dsp-dot dsp-dot--sm${dspState === "running" ? " running" : dspState === "starting" || dspState === "installing" || dspState === "authenticating" ? " pending" : " stopped"}`} />
              <span className="dsp-inline-label">
                DeepsProxy ·{" "}
                {{
                  checking: "verificando…",
                  not_installed: "não instalado",
                  installing: "instalando…",
                  installed_stopped: "parado",
                  authenticating: "autenticando…",
                  starting: "iniciando…",
                  running: "rodando",
                }[dspState]}
              </span>
            </div>
            <div className="dsp-inline-actions">
              {dspState === "not_installed" && (
                <button className="btn btn-sm btn-primary" onClick={handleDspInstall}>
                  <Download size={11} />
                  Instalar
                </button>
              )}
              {dspState === "installed_stopped" && (
                <>
                  <button className="btn btn-sm btn-secondary" onClick={handleDspLogin}>
                    <LogIn size={11} />
                    Autenticar
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={handleDspStart}>
                    <Play size={11} />
                    Iniciar proxy
                  </button>
                </>
              )}
              {(dspState === "starting" || dspState === "installing") && (
                <span className="dsp-inline-hint">aguardando…</span>
              )}
              {dspState === "authenticating" && (
                <button className="btn btn-sm btn-primary" onClick={handleDspCompleteLogin}>
                  <Check size={11} />
                  Fechar browser
                </button>
              )}
              {dspState === "running" && (
                <button className="btn btn-sm btn-secondary" onClick={handleDspStop}>
                  <Square size={11} />
                  Parar
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Claude.ai OAuth ────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-title">
          <BrandLogo provider="anthropic" size={16} />
          <span style={{ marginLeft: 6 }}>Claude.ai — Autenticação OAuth</span>
        </div>

        <div className="dsp-card">
          <div className="dsp-card-top">
            <div className="dsp-status">
              <span className={`dsp-dot${claudeOAuthState === "authenticated" ? " running" : claudeOAuthState === "authenticating" || claudeOAuthState === "waiting" || claudeOAuthState === "waiting_code" || claudeOAuthState === "submitting" || claudeOAuthState === "importing" || claudeOAuthState === "detecting" || claudeOAuthState === "installing" ? " pending" : claudeOAuthState === "error" ? " stopped" : ""}`} />
              <div className="dsp-status-info">
                <span className="dsp-status-label">
                  {{
                    idle: "Não autenticado",
                    detecting: "Verificando Claude Code CLI…",
                    installing: "Instalando Claude Code CLI…",
                    importing: "Importando credenciais…",
                    authenticating: "Abrindo browser de login…",
                    waiting: "Aguardando autorização no browser…",
                    waiting_code: "Cole o código exibido em platform.claude.com",
                    submitting: "Enviando código…",
                    authenticated: claudeOAuthCredential?.email
                      ? `Autenticado · ${claudeOAuthCredential.email}`
                      : "Autenticado",
                    error: `Erro: ${claudeOAuthError ?? "desconhecido"}`,
                  }[claudeOAuthState]}
                </span>
                {claudeOAuthState === "authenticated" && claudeOAuthCredential && (
                  <span className="dsp-token-badge" title="Token OAuth ativo">
                    <span className="dsp-token-label">token</span>
                    <span className="dsp-token-value">{claudeOAuthCredential.tokenPrefix}</span>
                  </span>
                )}
              </div>
            </div>

            <div className="dsp-actions">
              {(claudeOAuthState === "idle" || claudeOAuthState === "error") && (
                <>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleClaudeOAuthImport}
                    title="Importar credenciais salvas pelo Claude Code CLI (~/.claude.json)"
                  >
                    <Key size={12} />
                    Importar do Claude Code
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleClaudeOAuthLogin}
                  >
                    <LogIn size={12} />
                    Entrar com Claude.ai
                  </button>
                </>
              )}
              {(claudeOAuthState === "authenticating" || claudeOAuthState === "waiting" || claudeOAuthState === "importing" || claudeOAuthState === "detecting" || claudeOAuthState === "installing" || claudeOAuthState === "submitting") && (
                <span className="dsp-inline-hint">aguardando…</span>
              )}
              {claudeOAuthState === "waiting_code" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    O browser foi aberto em platform.claude.com — copie o código exibido e cole abaixo:
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="text"
                      className="settings-input"
                      placeholder="Cole o código aqui…"
                      value={claudeCodeInput}
                      onChange={(e) => setClaudeCodeInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleClaudeOAuthSubmitCode(); }}
                      autoFocus
                      style={{ flex: 1, fontSize: 12 }}
                    />
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => void handleClaudeOAuthSubmitCode()}
                      disabled={!claudeCodeInput.trim()}
                    >
                      <Check size={12} />
                      Confirmar
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => { setClaudeOAuthState("idle"); setClaudeCodeInput(""); }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
              {claudeOAuthState === "authenticated" && (
                <>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      modelLoaded.current = false;
                      setModelProvider("claude-oauth");
                      setModelBaseUrl("");
                      setModelName("claude-sonnet-4-5");
                      requestAnimationFrame(() => { modelLoaded.current = true; });
                      void window.hermesAPI.setModelConfig("claude-oauth", "claude-sonnet-4-5", "", profile);
                      window.dispatchEvent(new CustomEvent("hermes:model-changed"));
                    }}
                  >
                    <UserCheck size={12} />
                    Usar como provider ativo
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleClaudeOAuthLogout}
                  >
                    <LogOut size={12} />
                    Sair
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Passos */}
          {claudeOAuthState !== "authenticated" && (
            <div className="dsp-steps">
              <div className={`dsp-step${claudeOAuthState !== "idle" || claudeOAuthCredential ? " done" : ""}`}>
                <span className="dsp-step-num">1</span>
                <span>Autenticar — entrar com sua conta claude.ai (plano Pro ou Max)</span>
              </div>
              <div className="dsp-step">
                <span className="dsp-step-num">2</span>
                <span>Selecionar como provider ativo — usa seu plano sem chave de API</span>
              </div>
            </div>
          )}

          <div className="dsp-models">
            <span className="dsp-models-label">Modelos disponíveis:</span>
            {["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5", "claude-3-7-sonnet-20250219"].map((m) => (
              <span key={m} className="dsp-model-pill">{m}</span>
            ))}
          </div>

          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>
            Se tiver o <strong>Claude Code CLI</strong> instalado, clique em <em>Importar do Claude Code</em>
            para usar as credenciais já existentes em <code>~/.claude.json</code>.
            Caso contrário, clique em <em>Entrar com Claude.ai</em> para um fluxo OAuth completo.
          </div>
        </div>
      </div>

      {/* ── DeepsProxy ─────────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-title">
          DeepsProxy — DeepSeek via browser local
          <button
            className="dsp-refresh-btn"
            onClick={refreshDspState}
            disabled={dspState === "checking"}
            title="Verificar status"
          >
            <RefreshCw size={12} className={dspState === "checking" ? "dsp-spin" : ""} />
          </button>
        </div>

        <div className="dsp-card">
          {/* Status row */}
          <div className="dsp-card-top">
            <div className="dsp-status">
              <span className={`dsp-dot${dspState === "running" ? " running" : dspState === "starting" || dspState === "authenticating" || dspState === "installing" ? " pending" : dspState === "checking" ? "" : " stopped"}`} />
              <div className="dsp-status-info">
                <span className="dsp-status-label">
                  {{
                    checking: "Verificando…",
                    not_installed: "Não instalado",
                    installing: "Instalando… (pode demorar alguns minutos)",
                    installed_stopped: "Instalado · parado",
                    authenticating: "Browser de autenticação aberto",
                    starting: "Iniciando servidor…",
                    running: `Rodando em localhost:${dspPort}`,
                  }[dspState]}
                </span>
                {tokenPrefix && (
                  <span className="dsp-token-badge" title="Token Bearer capturado">
                    <span className="dsp-token-label">token</span>
                    <span className="dsp-token-value">{tokenPrefix}…</span>
                  </span>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="dsp-actions">
              {dspState === "not_installed" && (
                <button className="btn btn-primary btn-sm" onClick={handleDspInstall}>
                  <Download size={12} />
                  Instalar
                </button>
              )}
              {dspState === "installed_stopped" && (
                <>
                  <button className="btn btn-secondary btn-sm" onClick={handleDspLogin}>
                    <LogIn size={12} />
                    Autenticar DeepSeek
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={handleDspStart}>
                    <Play size={12} />
                    Iniciar proxy
                  </button>
                </>
              )}
              {dspState === "authenticating" && (
                <button className="btn btn-primary btn-sm" onClick={handleDspCompleteLogin}>
                  <Check size={12} />
                  Já autentiquei — fechar browser e iniciar proxy
                </button>
              )}
              {dspState === "running" && (
                <>
                  <button className="btn btn-primary btn-sm" onClick={handleActivateDeepsProxy}>
                    {dspActivated ? <><Check size={12} /> Ativado!</> : "Usar como modelo ativo"}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={handleDspStop}>
                    <Square size={12} />
                    Parar
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Step guide */}
          {dspState !== "checking" && dspState !== "installing" && (
            <div className="dsp-steps">
              <div className={`dsp-step${dspState !== "not_installed" ? " done" : ""}`}>
                <span className="dsp-step-num">1</span>
                <span>Instalar — clona o repositório e instala dependências</span>
              </div>
              <div className={`dsp-step${(hasAuthenticated || dspState === "starting" || dspState === "running" || dspState === "authenticating") ? " done" : ""}`}>
                <span className="dsp-step-num">2</span>
                <span>Autenticar — abre um browser Chromium para login no DeepSeek</span>
              </div>
              <div className={`dsp-step${dspState === "running" ? " done" : ""}`}>
                <span className="dsp-step-num">3</span>
                <span>Proxy iniciado — servidor rodando e pronto para receber requisições</span>
              </div>
              <div className={`dsp-step${(modelProvider === "custom" && modelBaseUrl.startsWith("http://localhost")) ? " done" : ""}`}>
                <span className="dsp-step-num">4</span>
                <span>Usar como modelo ativo — configura o Hermes automaticamente</span>
              </div>
            </div>
          )}

          {/* Models */}
          <div className="dsp-models">
            <span className="dsp-models-label">Modelos:</span>
            {["deepseek-v4-flash AUTH", "deepseek-v4-flash-thinking", "deepseek-v4-pro", "deepseek-v4-pro-thinking"].map((m) => (
              <span key={m} className="dsp-model-pill">{m}</span>
            ))}
          </div>

          {/* ── Token manual + pool de credenciais DeepSeek ──────────── */}
          <div className="dsp-pool-section">
            <div className="dsp-pool-header">
              <span className="dsp-pool-title">Pool de Tokens DeepSeek</span>
              {dspState === "running" && (
                <button
                  className="btn btn-sm btn-ghost dsp-reload-btn"
                  onClick={handleReloadAuth}
                  title="Forçar renovação do token agora"
                >
                  <RefreshCw size={11} />
                  Renovar token
                </button>
              )}
            </div>
            <div className="dsp-pool-hint">
              Insira um token Bearer do DeepSeek manualmente (obtido em chat.deepseek.com → F12 → Network → Authorization header). O proxy usa rotação automática entre todos os tokens do pool.
            </div>

            <div className="dsp-token-inject-row">
              <input
                className="input dsp-token-input"
                type="password"
                value={manualTokenInput}
                onChange={(e) => setManualTokenInput(e.target.value)}
                placeholder="AJzpgr4L0U2T... ou Bearer AJzpgr4L..."
                onKeyDown={(e) => { if (e.key === "Enter") handleSetManualToken(); }}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSetManualToken}
                disabled={!manualTokenInput.trim() || dspState !== "running"}
              >
                Injetar
              </button>
            </div>

            {poolStatus.count > 0 && (
              <div className="dsp-pool-tokens">
                <span className="dsp-pool-tokens-label">
                  {poolStatus.count} token{poolStatus.count !== 1 ? "s" : ""} no pool · próximo #{poolStatus.currentIndex}
                </span>
                <div className="dsp-pool-token-list">
                  {poolStatus.prefixes.map((prefix, i) => (
                    <div
                      key={i}
                      className={`dsp-pool-token-item${i === poolStatus.currentIndex ? " active" : ""}`}
                    >
                      <span className="dsp-pool-token-idx">#{i}</span>
                      <span className="dsp-pool-token-prefix">{prefix}…</span>
                      {i === poolStatus.currentIndex && (
                        <span className="dsp-pool-token-active-badge">ativo</span>
                      )}
                      <button
                        className="dsp-pool-token-remove"
                        onClick={() => handleRemovePoolToken(i)}
                        title="Remover token do pool"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Headless toggle */}
            <div className="dsp-headless-row">
              <label className="dsp-headless-label">
                <input
                  type="checkbox"
                  checked={!dspHeadless}
                  onChange={handleToggleHeadless}
                  className="dsp-headless-check"
                />
                Browser visível (headless=false) — requer reinício do proxy
              </label>
            </div>
          </div>

          {/* Log console */}
          {dspLog.length > 0 && (
            <div className="dsp-log" ref={dspLogRef}>
              {dspLog.map((line, i) => (
                <span key={i}>{line}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">
          {t("settings.sections.credentialPool")}
        </div>
        <div className="settings-field">
          <div className="settings-field-hint" style={{ marginBottom: 10 }}>
            {t("settings.poolHint")}
          </div>
          <div className="settings-pool-add">
            <select
              className="input"
              value={poolProvider}
              onChange={(e) => setPoolProvider(e.target.value)}
              style={{ width: 140 }}
            >
              <option value="">{t("common.provider")}</option>
              {PROVIDERS.options
                .filter((p) => p.value !== "auto")
                .map((p) => (
                  <option key={p.value} value={p.value}>
                    {t(p.label)}
                  </option>
                ))}
            </select>
            <input
              className="input"
              type="password"
              value={poolNewKey}
              onChange={(e) => setPoolNewKey(e.target.value)}
              placeholder={t("settings.apiKeyPlaceholder")}
              style={{ flex: 1 }}
            />
            <input
              className="input"
              type="text"
              value={poolNewLabel}
              onChange={(e) => setPoolNewLabel(e.target.value)}
              placeholder={t("settings.labelPlaceholder", {
                optional: t("common.optional"),
              })}
              style={{ width: 120 }}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={handleAddPoolKey}
              disabled={!poolProvider || !poolNewKey.trim()}
            >
              {t("settings.add")}
            </button>
          </div>
          {Object.entries(credPool).map(
            ([provider, entries]) =>
              entries.length > 0 && (
                <div key={provider} className="settings-pool-group">
                  <div className="settings-pool-provider">
                    <BrandLogo provider={provider} size={16} />
                    {PROVIDERS.options.find((p) => p.value === provider)
                      ? t(
                          PROVIDERS.options.find((p) => p.value === provider)!
                            .label,
                        )
                      : provider}
                  </div>
                  {entries.map((entry, idx) => (
                    <div key={idx} className="settings-pool-entry">
                      <span className="settings-pool-label">
                        {entry.label || `${t("settings.keyLabel")} ${idx + 1}`}
                      </span>
                      <span className="settings-pool-key">
                        {entry.key
                          ? `${entry.key.slice(0, 8)}...${entry.key.slice(-4)}`
                          : t("settings.empty")}
                      </span>
                      <button
                        className="btn-ghost"
                        style={{ color: "var(--error)", fontSize: 11 }}
                        onClick={() => handleRemovePoolKey(provider, idx)}
                      >
                        {t("settings.remove")}
                      </button>
                    </div>
                  ))}
                </div>
              ),
          )}
        </div>
      </div>

      {SETTINGS_SECTIONS.map((section) => {
        const isLlmProviders =
          section.title === "constants.sectionLlmProviders";
        return (
          <div key={section.title} className="settings-section">
            <div className="settings-section-title">{t(section.title)}</div>
            <div className={isLlmProviders ? "provider-keys-grid" : undefined}>
              {section.items.map((field) => (
                <div
                  key={field.key}
                  className={
                    isLlmProviders ? "provider-key-card" : "settings-field"
                  }
                >
                  {isLlmProviders && (
                    <div className="provider-key-card-head">
                      <BrandLogo provider={field.key} size={22} />
                      <span className="provider-key-card-title">
                        {t(field.label)}
                      </span>
                      {savedKey === field.key && (
                        <span className="settings-saved">
                          {t("common.saved")}
                        </span>
                      )}
                    </div>
                  )}
                  {!isLlmProviders && (
                    <label className="settings-field-label">
                      {t(field.label)}
                      {savedKey === field.key && (
                        <span className="settings-saved">
                          {t("common.saved")}
                        </span>
                      )}
                    </label>
                  )}
                  <div className="settings-input-row">
                    <input
                      className="input"
                      type={
                        field.type === "password" && !visibleKeys.has(field.key)
                          ? "password"
                          : "text"
                      }
                      value={env[field.key] || ""}
                      onChange={(e) => handleChange(field.key, e.target.value)}
                      onBlur={() => handleBlur(field.key)}
                      placeholder={t(field.label)}
                    />
                    {field.type === "password" && (
                      <button
                        className="btn-ghost settings-toggle-btn"
                        onClick={() => toggleVisibility(field.key)}
                      >
                        {visibleKeys.has(field.key)
                          ? t("common.hide")
                          : t("common.show")}
                      </button>
                    )}
                  </div>
                  <div className="settings-field-hint">{t(field.hint)}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default Providers;
