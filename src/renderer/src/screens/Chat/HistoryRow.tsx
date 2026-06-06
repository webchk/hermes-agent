import { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wrench,
  CheckCircle2,
  CircleX,
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
  FileOutput,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";
import { AttachmentChip } from "../../components/AttachmentChip";
import { HermesAvatar } from "./MessageRow";
import { ChainOfThought } from "../../components/ui/ChainOfThought";
import {
  AgentTaskQueue,
  parseTaskList,
} from "../../components/ui/AgentTaskQueue";
import type {
  Attachment,
  ReasoningMessage,
  ToolCallMessage,
  ToolResultMessage,
} from "./types";

/* ── Copy button ───────────────────────────────────────────────────────── */

function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  function handleCopy(): void {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }
  return (
    <motion.button
      className="hr-copy-btn"
      onClick={handleCopy}
      title={copied ? "Copiado!" : "Copiar"}
      whileTap={{ scale: 0.9 }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {copied ? (
          <motion.span
            key="check"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.15 }}
          >
            <Check size={12} strokeWidth={2.5} />
          </motion.span>
        ) : (
          <motion.span
            key="copy"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.15 }}
          >
            <Copy size={12} strokeWidth={2} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

/* ── Shared collapsible primitive ──────────────────────────────────────── */

interface CollapsibleProps {
  variant: "reasoning" | "tool-call" | "tool-result";
  header: React.ReactNode;
  actions?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const CollapsibleSection = memo(function CollapsibleSection({
  variant,
  header,
  actions,
  defaultOpen = false,
  children,
}: CollapsibleProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`hr-section hr-section--${variant}`}>
      <button
        className="hr-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="hr-chevron">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className="hr-header-content">{header}</span>
        {actions && (
          <span className="hr-header-actions" onClick={(e) => e.stopPropagation()}>
            {actions}
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="hr-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.65, 0.3, 0.9] }}
          >
            <div className="hr-body-inner">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

/* ── Reasoning / Chain of Thought ──────────────────────────────────────── */

export const ReasoningRow = memo(function ReasoningRow({
  msg,
}: {
  msg: ReasoningMessage;
}): React.JSX.Element {
  // Detect markdown task lists embedded in reasoning text
  const tasks = parseTaskList(msg.text);
  const hasQueue = tasks.length >= 2;

  return (
    <motion.div
      className="chat-message chat-message-agent chat-message-history"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      <HermesAvatar />
      <div className="hr-reasoning-wrap">
        <ChainOfThought text={msg.text} defaultOpen={false} />
        {hasQueue && (
          <div style={{ marginTop: 8 }}>
            <AgentTaskQueue tasks={tasks} title="Tarefas identificadas" defaultOpen={false} />
          </div>
        )}
      </div>
    </motion.div>
  );
});

/* ── Tool call ─────────────────────────────────────────────────────────── */

function summariseArgs(args: string): string {
  const flat = args.replace(/\s+/g, " ").trim();
  if (flat.length <= 80) return flat;
  return flat.slice(0, 77) + "…";
}

export const ToolCallRow = memo(function ToolCallRow({
  msg,
}: {
  msg: ToolCallMessage;
}): React.JSX.Element {
  const { t } = useI18n();
  const summary = summariseArgs(msg.args);

  return (
    <motion.div
      className="chat-message chat-message-agent chat-message-history"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      <HermesAvatar />
      <CollapsibleSection
        variant="tool-call"
        header={
          <span className="hr-label">
            <span className="hr-variant-icon hr-variant-icon--tool">
              <Wrench size={12} strokeWidth={2.2} />
            </span>
            <span className="hr-title">{t("chat.toolCall")}</span>
            <code className="hr-tool-name">{msg.name}</code>
            {summary && (
              <span className="hr-summary">{summary}</span>
            )}
          </span>
        }
        actions={<CopyButton text={msg.args} />}
      >
        <pre className="hr-pre hr-pre--code">{msg.args || "(sem argumentos)"}</pre>
      </CollapsibleSection>
    </motion.div>
  );
});

/* ── Tool result ───────────────────────────────────────────────────────── */

function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

function resultStatus(content: string): "ok" | "error" {
  if (/^(error|err:|failed|exception|traceback)/i.test(content.trim())) return "error";
  return "ok";
}

export const ToolResultRow = memo(function ToolResultRow({
  msg,
}: {
  msg: ToolResultMessage;
}): React.JSX.Element {
  const { t } = useI18n();
  const lines = countLines(msg.content);
  const hasAttachments = !!msg.attachments && msg.attachments.length > 0;
  const status = resultStatus(msg.content);

  return (
    <motion.div
      className="chat-message chat-message-agent chat-message-history"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      <HermesAvatar />
      <CollapsibleSection
        variant="tool-result"
        header={
          <span className="hr-label">
            <span className={`hr-variant-icon hr-variant-icon--result-${status}`}>
              {status === "ok" ? (
                <CheckCircle2 size={12} strokeWidth={2.2} />
              ) : (
                <CircleX size={12} strokeWidth={2.2} />
              )}
            </span>
            <span className="hr-title">{t("chat.toolResult")}</span>
            <code className="hr-tool-name">{msg.name}</code>
            <span className="hr-meta">
              <FileOutput size={11} strokeWidth={2} />
              {lines} {lines === 1 ? "linha" : "linhas"}
              {hasAttachments
                ? ` · ${msg.attachments!.length} anexo${msg.attachments!.length === 1 ? "" : "s"}`
                : ""}
            </span>
          </span>
        }
        actions={msg.content ? <CopyButton text={msg.content} /> : undefined}
      >
        {hasAttachments && (
          <div className="hr-attachments">
            {msg.attachments!.map((att: Attachment) => (
              <AttachmentChip key={att.id} attachment={att} />
            ))}
          </div>
        )}
        <pre className="hr-pre hr-pre--scroll">
          {msg.content || "(vazio)"}
        </pre>
      </CollapsibleSection>
    </motion.div>
  );
});
