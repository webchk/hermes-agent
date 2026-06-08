import { useCallback, useEffect, useMemo, useState } from "react";
import { PROVIDERS } from "../../../constants";
import { useI18n } from "../../../components/useI18n";
import type { ModelGroup } from "../types";

interface UseModelConfigResult {
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  modelGroups: ModelGroup[];
  displayModel: string;
  reload: () => Promise<void>;
  selectModel: (
    provider: string,
    model: string,
    baseUrl: string,
  ) => Promise<void>;
}

// Modelos claude-oauth sempre disponíveis no picker mesmo sem salvar manualmente
const BUILTIN_CLAUDE_OAUTH = [
  { provider: "claude-oauth", model: "claude-opus-4-5", name: "Claude Opus 4.5 — CLI Auth", baseUrl: "" },
  { provider: "claude-oauth", model: "claude-sonnet-4-5", name: "Claude Sonnet 4.5 — CLI Auth", baseUrl: "" },
  { provider: "claude-oauth", model: "claude-haiku-4-5", name: "Claude Haiku 4.5 — CLI Auth", baseUrl: "" },
  { provider: "claude-oauth", model: "claude-opus-4-0", name: "Claude Opus 4.0 — CLI Auth", baseUrl: "" },
  { provider: "claude-oauth", model: "claude-sonnet-4-0", name: "Claude Sonnet 4.0 — CLI Auth", baseUrl: "" },
];

function groupModelsByProvider(
  models: { provider: string; model: string; name: string; baseUrl?: string }[],
): ModelGroup[] {
  // Injeta built-ins claude-oauth que ainda não foram salvos manualmente
  const savedKeys = new Set(models.map((m) => `${m.provider}:${m.model}`));
  const merged = [
    ...models,
    ...BUILTIN_CLAUDE_OAUTH.filter((b) => !savedKeys.has(`${b.provider}:${b.model}`)),
  ];

  const groupMap = new Map<string, ModelGroup>();
  for (const m of merged) {
    if (!groupMap.has(m.provider)) {
      groupMap.set(m.provider, {
        provider: m.provider,
        providerLabel: PROVIDERS.labels[m.provider] || m.provider,
        models: [],
      });
    }
    groupMap.get(m.provider)!.models.push({
      provider: m.provider,
      model: m.model,
      label: m.name,
      baseUrl: m.baseUrl || "",
    });
  }
  return Array.from(groupMap.values());
}

export function useModelConfig(profile?: string): UseModelConfigResult {
  const { t } = useI18n();
  const [currentModel, setCurrentModel] = useState("");
  const [currentProvider, setCurrentProvider] = useState("auto");
  const [currentBaseUrl, setCurrentBaseUrl] = useState("");
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);

  const reload = useCallback(async (): Promise<void> => {
    const [mc, savedModels] = await Promise.all([
      window.hermesAPI.getModelConfig(profile),
      window.hermesAPI.listModels(),
    ]);
    setCurrentModel(mc.model);
    setCurrentProvider(mc.provider);
    setCurrentBaseUrl(mc.baseUrl);
    setModelGroups(groupModelsByProvider(savedModels));
  }, [profile]);

  // Initial load + reload whenever the profile changes (canonical
  // load-on-mount; setState happens inside `reload` via an awaited IPC call).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  // Reload whenever another screen (e.g. Providers) changes the active model
  useEffect(() => {
    const handler = () => { reload(); };
    window.addEventListener("hermes:model-changed", handler);
    return () => window.removeEventListener("hermes:model-changed", handler);
  }, [reload]);

  const selectModel = useCallback(
    async (provider: string, model: string, baseUrl: string): Promise<void> => {
      // Named providers (deepseek, groq, anthropic, …) have a hardcoded
      // canonical base_url in `hermes-agent`'s PROVIDER_REGISTRY.  A stored
      // model entry that carries a stale `baseUrl` from an earlier confused
      // save (e.g. a deepseek-tagged entry whose baseUrl points at the codex
      // endpoint) would route the request to the wrong host.  Drop the
      // baseUrl whenever the entry isn't `custom`; the gateway falls back
      // to the provider's canonical URL.
      const effectiveBaseUrl = provider === "custom" ? baseUrl : "";
      await window.hermesAPI.setModelConfig(
        provider,
        model,
        effectiveBaseUrl,
        profile,
      );
      setCurrentModel(model);
      setCurrentProvider(provider);
      setCurrentBaseUrl(effectiveBaseUrl);
    },
    [profile],
  );

  const displayModel = useMemo(
    () =>
      currentModel
        ? currentModel.split("/").pop() || currentModel
        : currentProvider === "auto"
          ? t("chat.auto")
          : t("chat.noModel"),
    [currentModel, currentProvider, t],
  );

  return {
    currentModel,
    currentProvider,
    currentBaseUrl,
    modelGroups,
    displayModel,
    reload,
    selectModel,
  };
}
