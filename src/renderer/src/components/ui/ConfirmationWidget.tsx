/**
 * ConfirmationWidget — beautiful inline approval/denial prompt.
 *
 * Replaces the basic approval bar in MessageRow when the agent emits
 * text matching APPROVAL_RE. Slides in from below with a spring animation.
 */
import { memo } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, XCircle, ShieldAlert } from "lucide-react";

interface ConfirmationWidgetProps {
  onApprove: () => void;
  onDeny: () => void;
  /** Optional prompt text extracted from the message — shown as a subtitle. */
  prompt?: string;
}

export const ConfirmationWidget = memo(function ConfirmationWidget({
  onApprove,
  onDeny,
  prompt,
}: ConfirmationWidgetProps): React.JSX.Element {
  return (
    <motion.div
      className="confirm-widget"
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.97 }}
      transition={{
        type: "spring",
        stiffness: 420,
        damping: 28,
      }}
    >
      {/* Warning badge */}
      <div className="confirm-badge">
        <ShieldAlert size={14} strokeWidth={2.2} />
        <span>Ação requer confirmação</span>
      </div>

      {prompt && <p className="confirm-prompt">{prompt}</p>}

      <div className="confirm-actions">
        <motion.button
          className="confirm-btn confirm-btn--approve"
          onClick={onApprove}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
        >
          <CheckCircle2 size={14} strokeWidth={2.2} />
          <span>Aprovar</span>
        </motion.button>
        <motion.button
          className="confirm-btn confirm-btn--deny"
          onClick={onDeny}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
        >
          <XCircle size={14} strokeWidth={2.2} />
          <span>Negar</span>
        </motion.button>
      </div>

      <p className="confirm-hint">
        <AlertTriangle size={11} strokeWidth={2} />
        Esta operação pode ter efeitos irreversíveis
      </p>
    </motion.div>
  );
});
