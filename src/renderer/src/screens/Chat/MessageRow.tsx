import { memo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Check } from "lucide-react";
import icon from "../../assets/icon.png";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { AttachmentChip } from "../../components/AttachmentChip";
import { ConfirmationWidget } from "../../components/ui/ConfirmationWidget";
import {
  AgentTaskQueue,
  parseTaskList,
} from "../../components/ui/AgentTaskQueue";
import { filterSystemContent } from "../../hooks/useContentFilter";
import type { Attachment, ChatBubbleMessage, ChatMessage } from "./types";

export const APPROVAL_RE =
  /⚠️.*dangerous|requires? (your )?approval|\/approve.*\/deny|do you want (me )?to (proceed|continue|run|execute)/i;

function isChatBubbleMessage(msg: ChatMessage): msg is ChatBubbleMessage {
  return (
    msg.kind === "user" ||
    msg.kind === "assistant" ||
    (!msg.kind && (msg.role === "user" || msg.role === "agent"))
  );
}

export const HermesAvatar = memo(function HermesAvatar({
  size = 30,
}: {
  size?: number;
}): React.JSX.Element {
  return (
    <div className="chat-avatar chat-avatar-agent">
      <img src={icon} width={size} height={size} alt="" />
    </div>
  );
});

/* ── Copy button (for agent messages) ─────────────────────────────────── */

function MessageCopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <motion.button
      className="msg-copy-btn"
      onClick={handleCopy}
      title={copied ? "Copiado!" : "Copiar resposta"}
      initial={{ opacity: 0 }}
      whileHover={{ opacity: 1, scale: 1.05 }}
      whileTap={{ scale: 0.93 }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {copied ? (
          <motion.span
            key="check"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="msg-copy-icon msg-copy-icon--done"
          >
            <Check size={13} strokeWidth={2.5} />
          </motion.span>
        ) : (
          <motion.span
            key="copy"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="msg-copy-icon"
          >
            <Copy size={13} strokeWidth={2} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

/* ── Main MessageRow ────────────────────────────────────────────────────── */

interface MessageRowProps {
  msg: ChatMessage;
  isLast: boolean;
  isLoading: boolean;
  onApprove: () => void;
  onDeny: () => void;
}

export const MessageRow = memo(function MessageRow({
  msg,
  isLast,
  isLoading,
  onApprove,
  onDeny,
}: MessageRowProps): React.JSX.Element {
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);

  if (!isChatBubbleMessage(msg)) {
    return (
      <div className={`chat-message chat-message-${msg.role}`}>
        <HermesAvatar />
        <div className={`chat-bubble chat-bubble-${msg.role}`} />
      </div>
    );
  }

  const showApprovalBar =
    msg.role === "agent" && !isLoading && isLast && APPROVAL_RE.test(msg.content);
  const hasAttachments = !!msg.attachments && msg.attachments.length > 0;

  // Detect task lists in agent messages
  const filteredContent =
    msg.role === "agent" ? filterSystemContent(msg.content) : msg.content;
  const tasks = msg.role === "agent" ? parseTaskList(filteredContent) : [];
  const hasTaskQueue = tasks.length >= 2;

  return (
    <motion.div
      className={`chat-message chat-message-${msg.role}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      {msg.role === "user" ? (
        <div className="chat-avatar chat-avatar-user">U</div>
      ) : (
        <HermesAvatar />
      )}

      <div className="chat-message-content-wrap">
        <div className={`chat-bubble chat-bubble-${msg.role}`}>
          {hasAttachments && (
            <div className="chat-message-attachments">
              {msg.attachments!.map((att) => (
                <AttachmentChip
                  key={att.id}
                  attachment={att}
                  onPreview={(a) => a.kind === "image" && setPreviewAttachment(a)}
                />
              ))}
            </div>
          )}
          {msg.content &&
            (msg.role === "agent" ? (
              <AgentMarkdown>{filteredContent}</AgentMarkdown>
            ) : (
              msg.content
            ))}
        </div>

        {/* Task queue (parsed from markdown task lists in agent replies) */}
        {hasTaskQueue && (
          <div className="chat-task-queue-wrap">
            <AgentTaskQueue tasks={tasks} title="Tarefas" defaultOpen={true} />
          </div>
        )}

        {/* Copy button — hovers in bottom-right of agent bubble */}
        {msg.role === "agent" && msg.content && (
          <div className="msg-copy-wrap">
            <MessageCopyButton text={msg.content} />
          </div>
        )}

        {/* Confirmation widget (replaces the old inline approval bar) */}
        <AnimatePresence>
          {showApprovalBar && (
            <ConfirmationWidget
              onApprove={onApprove}
              onDeny={onDeny}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Image preview lightbox */}
      {previewAttachment && previewAttachment.dataUrl && (
        <div
          className="chat-image-preview-backdrop"
          onClick={() => setPreviewAttachment(null)}
          role="dialog"
          aria-modal="true"
        >
          <img
            src={previewAttachment.dataUrl}
            alt={previewAttachment.name}
            className="chat-image-preview-image"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </motion.div>
  );
});
