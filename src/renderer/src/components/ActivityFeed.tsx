/**
 * ActivityFeed — Souza/JS visible runtime activity panel.
 *
 * Renders tool lifecycle entries in the Claude Code-style format:
 *
 *   ◐ Lendo arquivos
 *     ⎿ package.json
 *
 *   ⚙ Executando
 *     ⎿ npm run build
 *
 *   ● Concluído (completed)   ✗ Erro (error)
 *
 * Phase classification is heuristic on tool name — no prompt engineering
 * required (the LLM can keep emitting whatever; we infer the visual
 * category from the tool that ran).
 */
import { memo, useState, useCallback } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDotDashed,
  CircleX,
  FileText,
  FolderOpen,
  Pencil,
  Terminal,
  Globe,
  Search,
  Trash2,
  Camera,
  CheckCheck,
  Package,
  Brain,
  Wrench,
  Sparkles,
  Send,
  Zap,
  Database,
  Shield,
  Code2,
  GitBranch,
  RefreshCw,
  Cpu,
  BookOpen,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { ActivityEntry, ToolActivityEntry } from "../hooks/useActivityFeed";
import { TextScramble } from "./ui/TextScramble";

/**
 * Classification rules map raw tool names to a human-friendly phase label
 * plus an icon component (Lucide) used as the leading visual marker.
 * Souza/JS: Lucide replaces the previous emoji icons so colors can convey
 * status (success=green, error=red, running=blue, pending=muted) instead
 * of just identity.
 */
const PHASE_RULES: Array<{
  match: RegExp;
  phase: string;
  Icon: LucideIcon;
}> = [
  // File reading
  { match: /(^|_)(read|cat|view|get_file|fetch_file|open_file)(_|$)/i, phase: "Lendo arquivos do projeto", Icon: FolderOpen },
  // Directory listing / exploration
  { match: /(^|_)(ls|list|tree|dir|directory|explore)(_|$)/i, phase: "Explorando estrutura", Icon: FolderOpen },
  // File creation
  { match: /(^|_)(write|create|save|new_file|touch|scaffold_file)(_|$)/i, phase: "Criando novos arquivos", Icon: FileText },
  // Code editing / patching
  { match: /(^|_)(edit|patch|replace|update|modify|apply|refactor|rewrite)(_|$)/i, phase: "Editando código", Icon: Pencil },
  // Code generation
  { match: /(^|_)(generat|codegen|implement|generate)(_|$)/i, phase: "Gerando código", Icon: Code2 },
  // Shell / terminal
  { match: /(^|_)(shell|bash|exec|command|run|terminal|spawn|invoke|cli)(_|$)/i, phase: "Executando comandos", Icon: Terminal },
  // Search / find
  { match: /(^|_)(search|grep|find|query|lookup|locate)(_|$)/i, phase: "Pesquisando no projeto", Icon: Search },
  // Delete / clean
  { match: /(^|_)(delete|remove|rm|unlink|clean|purge)(_|$)/i, phase: "Removendo arquivos", Icon: Trash2 },
  // Screenshot / capture
  { match: /(^|_)(screenshot|capture|snapshot|photo|screen)(_|$)/i, phase: "Capturando tela", Icon: Camera },
  // Navigate / browse
  { match: /(^|_)(navigate|browse|goto|open_url|web_fetch|url)(_|$)/i, phase: "Navegando", Icon: Globe },
  // Tests / validation
  { match: /(^|_)(test|spec|jest|pytest|validate|check|lint|verify|coverage)(_|$)/i, phase: "Executando testes", Icon: CheckCheck },
  // Install dependencies
  { match: /(^|_)(install|npm|pip|yarn|pnpm|dep|package|require)(_|$)/i, phase: "Instalando dependências", Icon: Package },
  // Build / compile
  { match: /(^|_)(build|compile|bundle|transpil|webpack|vite|tsc|make)(_|$)/i, phase: "Compilando projeto", Icon: Cpu },
  // Database / migrations
  { match: /(^|_)(migrat|schema|seed|database|db|sql|orm|prisma)(_|$)/i, phase: "Executando migrações", Icon: Database },
  // Auth / security
  { match: /(^|_)(auth|login|token|jwt|oauth|secur|permission|credential)(_|$)/i, phase: "Configurando autenticação", Icon: Shield },
  // Documentation
  { match: /(^|_)(doc|document|readme|comment|jsdoc|swagger)(_|$)/i, phase: "Gerando documentação", Icon: BookOpen },
  // Deploy / git / publish
  { match: /(^|_)(deploy|publish|push|release|commit|git|pipeline|cicd)(_|$)/i, phase: "Publicando projeto", Icon: GitBranch },
  // Debug / fix
  { match: /(^|_)(debug|diagnos|fix|repair|hotfix|trace_error)(_|$)/i, phase: "Depurando código", Icon: RefreshCw },
  // Analyze / inspect / audit
  { match: /(^|_)(analyz|inspect|detect|discover|audit|scan|profile)(_|$)/i, phase: "Analisando projeto", Icon: Activity },
  // Config / setup / init
  { match: /(^|_)(configur|setup|init|environ|setting)(_|$)/i, phase: "Configurando projeto", Icon: Wrench },
  // Monitoring / logs
  { match: /(^|_)(monitor|metric|log|observ|watch|report|stat)(_|$)/i, phase: "Monitorando execução", Icon: Activity },
  // Skills
  { match: /(^|_)(skill|skills_)/i, phase: "Aplicando skill", Icon: Sparkles },
  // MCP tools
  { match: /^mcp_/i, phase: "Ferramenta MCP", Icon: Wrench },
];

// Synthetic phase shortcuts injected by MessageList (sending / thinking / streaming / done).
const SYNTHETIC: Record<string, { phase: string; Icon: LucideIcon }> = {
  sending:   { phase: "Enviando solicitação", Icon: Send },
  thinking:  { phase: "Analisando contexto", Icon: Brain },
  streaming: { phase: "Gerando resposta", Icon: Zap },
  planning:  { phase: "Elaborando plano", Icon: Sparkles },
  hooking:   { phase: "Preparando ferramenta", Icon: Wrench },
  done:      { phase: "Tarefa concluída", Icon: CheckCircle2 },
};

function classify(tool: string): { phase: string; Icon: LucideIcon } {
  const synth = SYNTHETIC[tool];
  if (synth) return synth;
  for (const rule of PHASE_RULES) {
    if (rule.match.test(tool)) return { phase: rule.phase, Icon: rule.Icon };
  }
  return { phase: tool || "Executando", Icon: Wrench };
}

/**
 * Status icon chosen by entry.status. Lucide ones are colored via the CSS
 * stroke=currentColor + `.activity-row.*` color rules in main.css.
 */
function statusIconFor(status: ToolActivityEntry["status"]): LucideIcon {
  if (status === "completed") return CheckCircle2;
  if (status === "error") return CircleX;
  if (status === "running") return CircleDotDashed;
  return Circle;
}

/** Pretty-print args/result if they're JSON; otherwise return as-is. */
function pretty(value: unknown): string {
  if (value == null) return "";
  if (typeof value !== "string") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  // Try to detect JSON-encoded strings and pretty-print them
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      // not actually JSON, return raw
    }
  }
  return value;
}

/** Returns true only if value serializes to something non-trivially empty. */
function isNonEmpty(val: unknown): boolean {
  if (val == null) return false;
  if (typeof val === "string") return val.trim().length > 0;
  try {
    const s = JSON.stringify(val);
    return s !== "{}" && s !== "[]" && s.trim().length > 2;
  } catch {
    return false;
  }
}

/** One-line summary built from label/args for the always-visible row. */
function summaryFor(entry: ToolActivityEntry): string {
  if (entry.label) {
    const stripped = entry.label
      .replace(new RegExp(`^${entry.tool}\\s*`), "")
      .trim();
    if (stripped) return stripped;
  }
  if (isNonEmpty(entry.args)) {
    const argsStr =
      typeof entry.args === "string"
        ? entry.args
        : JSON.stringify(entry.args);
    return argsStr.slice(0, 120) + (argsStr.length > 120 ? "…" : "");
  }
  return "";
}

const ActivityRow = memo(function ActivityRow({
  entry,
  tick: _tick,
}: {
  entry: ToolActivityEntry;
  /** Kept for API compat with parent; not used now that animation comes
   * from CSS keyframes on the status icon (less re-render churn). */
  tick: number;
}): React.JSX.Element {
  const { phase, Icon: PhaseIcon } = classify(entry.tool);
  const StatusIcon = statusIconFor(entry.status);
  const summary = summaryFor(entry);

  const hasArgs = isNonEmpty(entry.args);
  const hasResult = typeof entry.result === "string" && entry.result.trim().length > 0;
  const [expanded, setExpanded] = useState(false);
  const [copiedArgs, setCopiedArgs] = useState(false);
  const [copiedResult, setCopiedResult] = useState(false);
  const isExpandable = hasArgs || hasResult;

  const handleCopyArgs = useCallback(() => {
    navigator.clipboard.writeText(pretty(entry.args)).then(() => {
      setCopiedArgs(true);
      setTimeout(() => setCopiedArgs(false), 1500);
    }).catch(() => {});
  }, [entry.args]);

  const handleCopyResult = useCallback(() => {
    navigator.clipboard.writeText(pretty(entry.result)).then(() => {
      setCopiedResult(true);
      setTimeout(() => setCopiedResult(false), 1500);
    }).catch(() => {});
  }, [entry.result]);
  const isExpanded = expanded;

  const statusClass =
    entry.status === "completed"
      ? "activity-row activity-completed"
      : entry.status === "error"
        ? "activity-row activity-error"
        : "activity-row activity-running";

  const durationLabel =
    entry.status !== "running" && entry.durationMs
      ? ` (${Math.max(1, Math.round(entry.durationMs / 100) / 10).toFixed(1)}s)`
      : entry.status === "running" && entry.startedAt
        ? ` (${Math.max(0, Math.round((Date.now() - entry.startedAt) / 100) / 10).toFixed(1)}s)`
        : "";

  const isRunning = entry.status === "running";
  const phaseLabel = `${phase}${isRunning ? "..." : ""}`;

  return (
    <motion.div
      className={statusClass}
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { type: "spring", stiffness: 500, damping: 30 },
      }}
      exit={{
        opacity: 0,
        y: -4,
        transition: { duration: 0.15 },
      }}
    >
      <div className="activity-line">
        {/* Phase icon (purpose) + status icon (lifecycle) side-by-side */}
        <span className="activity-icons">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={entry.status}
              className="activity-status-icon"
              initial={{ opacity: 0, scale: 0.7, rotate: -10 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.7, rotate: 10 }}
              transition={{
                duration: 0.2,
                ease: [0.2, 0.65, 0.3, 0.9],
              }}
            >
              <StatusIcon size={14} strokeWidth={2.2} />
            </motion.span>
          </AnimatePresence>
          <span className="activity-phase-icon" aria-hidden="true">
            <PhaseIcon size={13} strokeWidth={2} />
          </span>
        </span>

        <span className="activity-phase">
          {isRunning ? (
            <TextScramble
              as="span"
              className="activity-phase-text"
              speed={0.035}
              duration={0.55}
              trigger={true}
              characterSet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789áéíóúçãâêõ•▲▼◆◇○●"
            >
              {phaseLabel}
            </TextScramble>
          ) : (
            phaseLabel
          )}
          {durationLabel ? (
            <span className="activity-duration">{durationLabel}</span>
          ) : null}
        </span>
      </div>

      {/* One-line summary row (always visible if any) */}
      {summary && (
        <div className="activity-detail">
          <span className="activity-detail-marker">⎿</span>
          <span className="activity-detail-badge">{summary}</span>
          {isExpandable && (
            <button
              type="button"
              className="activity-expand-toggle"
              onClick={() => setExpanded((x) => !x)}
              aria-label={
                isExpanded ? "Ocultar conteúdo" : "Ver código/conteúdo"
              }
              title={isExpanded ? "Ocultar conteúdo" : "Ver código/conteúdo"}
            >
              {isExpanded ? (
                <ChevronDown size={12} strokeWidth={2.2} />
              ) : (
                <ChevronRight size={12} strokeWidth={2.2} />
              )}
              <span className="activity-expand-toggle-label">
                {isExpanded ? "Ocultar" : "Ver código"}
              </span>
            </button>
          )}
        </div>
      )}

      {/* Expanded: real args/result code block (Souza/JS — "código em tempo real") */}
      <AnimatePresence initial={false}>
        {isExpanded && isExpandable && (
          <motion.div
            className="activity-codeblock-wrap"
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{
              duration: 0.22,
              ease: [0.2, 0.65, 0.3, 0.9],
            }}
          >
            {hasArgs && (
              <div className="activity-codeblock">
                <div className="activity-codeblock-header">
                  <span>Argumentos</span>
                  <button
                    type="button"
                    className={`activity-codeblock-copy${copiedArgs ? " activity-codeblock-copy--copied" : ""}`}
                    onClick={handleCopyArgs}
                    title="Copiar para área de transferência"
                  >
                    {copiedArgs ? "✓ copiado" : "copiar"}
                  </button>
                </div>
                <pre className="activity-codeblock-pre">
                  <code>{pretty(entry.args)}</code>
                </pre>
              </div>
            )}
            {hasResult && (
              <div className="activity-codeblock">
                <div className="activity-codeblock-header">
                  <span>
                    {entry.status === "error" ? "Resultado (erro)" : "Resultado"}
                  </span>
                  <button
                    type="button"
                    className={`activity-codeblock-copy${copiedResult ? " activity-codeblock-copy--copied" : ""}`}
                    onClick={handleCopyResult}
                    title="Copiar para área de transferência"
                  >
                    {copiedResult ? "✓ copiado" : "copiar"}
                  </button>
                </div>
                <pre className="activity-codeblock-pre">
                  <code>{pretty(entry.result)}</code>
                </pre>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

/**
 * Visual separator between conversation turns. Renders as a thin horizontal
 * rule with a centered timestamp/label. Used to keep the full session
 * activity history visible while making turn boundaries scannable.
 */
const DividerRow = memo(function DividerRow({
  label,
  at,
}: {
  label: string;
  at: number;
}): React.JSX.Element {
  const time = new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <motion.div
      className="activity-divider"
      initial={{ opacity: 0, scaleX: 0.85 }}
      animate={{ opacity: 1, scaleX: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <span className="activity-divider-line" />
      <span className="activity-divider-label">
        {label} · {time}
      </span>
      <span className="activity-divider-line" />
    </motion.div>
  );
});

export const ActivityFeed = memo(function ActivityFeed({
  entries,
  tick,
}: {
  entries: ActivityEntry[];
  /** Externally-driven tick (kept for API compat; not consumed anymore). */
  tick: number;
}): React.JSX.Element | null {
  if (entries.length === 0) return null;
  return (
    <motion.div className="activity-feed" layout>
      <AnimatePresence initial={false}>
        {entries.map((e) => {
          if (e.kind === "divider") {
            return <DividerRow key={e.id} label={e.label} at={e.at} />;
          }
          return (
            <ActivityRow
              key={e.toolCallId || `${e.tool}-${e.startedAt}`}
              entry={e}
              tick={tick}
            />
          );
        })}
      </AnimatePresence>
    </motion.div>
  );
});
