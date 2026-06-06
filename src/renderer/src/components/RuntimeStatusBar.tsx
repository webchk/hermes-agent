/**
 * RuntimeStatusBar — Souza/JS.
 *
 * Persistent footer-style strip inside the Chat screen showing:
 *   - Connection target (Local / SSH / Remote) + healthy dot
 *   - Active model
 *   - Token usage of the current turn (prompt/completion/total)
 *   - Agent state (Pronto / Pensando / Streaming / Erro)
 *   - Plan mode flag
 *
 * Goal: at a glance the user knows what the agent is doing, how much
 * context is being burned and whether plan-mode is on — without
 * clicking into Settings/Sessions panels.
 */
import { memo } from "react";
import {
  Cpu,
  Hash,
  Plug2,
  ShieldCheck,
  Sparkles,
  Wifi,
  WifiOff,
} from "lucide-react";

export interface RuntimeStatusBarProps {
  connectionMode: "local" | "ssh" | "remote";
  gatewayHealthy: boolean;
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
  } | null;
  isLoading: boolean;
  hasError?: boolean;
  planMode?: boolean;
}

function fmtTokens(n?: number): string {
  if (!n || n <= 0) return "0";
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1) + "k";
  return Math.round(n / 1000) + "k";
}

function fmtCost(c?: number): string | null {
  if (typeof c !== "number" || c <= 0) return null;
  if (c < 0.01) return "<$0.01";
  return `$${c.toFixed(2)}`;
}

export const RuntimeStatusBar = memo(function RuntimeStatusBar({
  connectionMode,
  gatewayHealthy,
  model,
  usage,
  isLoading,
  hasError,
  planMode,
}: RuntimeStatusBarProps): React.JSX.Element {
  const stateLabel = hasError
    ? "Erro"
    : isLoading
      ? "Pensando"
      : "Pronto";
  const stateClass = hasError
    ? "rs-state rs-state-error"
    : isLoading
      ? "rs-state rs-state-running"
      : "rs-state rs-state-idle";

  const ConnIcon = !gatewayHealthy ? WifiOff : connectionMode === "local" ? Plug2 : Wifi;
  const connLabel =
    connectionMode === "ssh"
      ? "SSH"
      : connectionMode === "remote"
        ? "Remoto"
        : "Local";

  const cost = fmtCost(usage?.cost);

  return (
    <div className="runtime-status-bar" role="status" aria-live="polite">
      <div className="rs-cluster rs-cluster-left">
        <span className={stateClass}>
          <span className="rs-state-dot" />
          {stateLabel}
        </span>

        {planMode && (
          <span className="rs-chip rs-chip-plan" title="Plan mode ativo: agente apresenta plano antes de executar">
            <ShieldCheck size={11} strokeWidth={2.2} />
            Plan mode
          </span>
        )}
      </div>

      <div className="rs-cluster rs-cluster-right">
        {model && (
          <span className="rs-chip" title="Modelo ativo">
            <Sparkles size={11} strokeWidth={2.2} />
            {model}
          </span>
        )}

        <span
          className={`rs-chip ${gatewayHealthy ? "rs-chip-ok" : "rs-chip-err"}`}
          title={
            gatewayHealthy
              ? `Gateway ${connLabel} respondendo`
              : `Gateway ${connLabel} indisponível`
          }
        >
          <ConnIcon size={11} strokeWidth={2.2} />
          {connLabel}
        </span>

        {usage && usage.totalTokens > 0 && (
          <span className="rs-chip" title="Tokens da última turn (in / out / total)">
            <Hash size={11} strokeWidth={2.2} />
            {fmtTokens(usage.promptTokens)} ↗ {fmtTokens(usage.completionTokens)} ·{" "}
            <strong>{fmtTokens(usage.totalTokens)}</strong>
            {cost ? ` · ${cost}` : ""}
          </span>
        )}

        {usage && usage.totalTokens === 0 && (
          <span className="rs-chip rs-chip-muted" title="Sem turns ainda nesta sessão">
            <Cpu size={11} strokeWidth={2.2} />
            0 tokens
          </span>
        )}
      </div>
    </div>
  );
});
