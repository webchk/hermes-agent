/**
 * ChainOfThought — animated, step-by-step reasoning visualizer.
 *
 * Renders the agent's `reasoning` text as a visual chain of thought:
 * each paragraph becomes an animated "step" that slides in sequentially,
 * giving the impression of watching the model think in real time.
 */
import { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Search,
  GitBranch,
  AlertCircle,
  CheckCircle2,
  Dot,
} from "lucide-react";

/* ── Heuristics: classify each paragraph of the reasoning ─────────────── */

type StepKind =
  | "observation"
  | "hypothesis"
  | "search"
  | "branch"
  | "warning"
  | "conclusion"
  | "thought";

interface ThoughtStep {
  id: number;
  kind: StepKind;
  text: string;
}

const KIND_RULES: Array<{ re: RegExp; kind: StepKind }> = [
  { re: /^(wait|hmm|actually|but|however|on second|let me reconsider)/i, kind: "branch" },
  { re: /^(i (need to|should|must|will|can)|let me|first|next|then|now)/i, kind: "observation" },
  { re: /^(so |therefore|thus|in conclusion|the answer|finally|this means)/i, kind: "conclusion" },
  { re: /^(maybe|perhaps|could|might|possibly|probably|it seems)/i, kind: "hypothesis" },
  { re: /^(looking|searching|checking|reading|examining|finding)/i, kind: "search" },
  { re: /^(error|problem|issue|wrong|incorrect|fail|warning|caution)/i, kind: "warning" },
];

function classifyStep(text: string): StepKind {
  const trimmed = text.trim();
  for (const rule of KIND_RULES) {
    if (rule.re.test(trimmed)) return rule.kind;
  }
  return "thought";
}

function kindIcon(kind: StepKind): React.ReactElement {
  const props = { size: 13, strokeWidth: 2.2 };
  switch (kind) {
    case "observation":  return <Lightbulb {...props} />;
    case "hypothesis":   return <GitBranch {...props} />;
    case "search":       return <Search {...props} />;
    case "branch":       return <ChevronRight {...props} />;
    case "warning":      return <AlertCircle {...props} />;
    case "conclusion":   return <CheckCircle2 {...props} />;
    default:             return <Dot {...props} />;
  }
}

function splitIntoSteps(text: string): ThoughtStep[] {
  // Split on double newlines (paragraphs) or numbered lines
  const rawParts = text
    .split(/\n{2,}|\n(?=\d+\.|[-*•])/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return rawParts.map((text, i) => ({
    id: i,
    kind: classifyStep(text),
    text,
  }));
}

/* ── Single step card ──────────────────────────────────────────────────── */

const StepCard = memo(function StepCard({
  step,
  index,
}: {
  step: ThoughtStep;
  index: number;
}): React.JSX.Element {
  return (
    <motion.div
      className={`cot-step cot-step--${step.kind}`}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        delay: index * 0.04,
        duration: 0.28,
        ease: [0.2, 0.65, 0.3, 0.9],
      }}
    >
      <span className="cot-step-icon">{kindIcon(step.kind)}</span>
      <p className="cot-step-text">{step.text}</p>
    </motion.div>
  );
});

/* ── Main component ────────────────────────────────────────────────────── */

interface ChainOfThoughtProps {
  text: string;
  defaultOpen?: boolean;
}

export const ChainOfThought = memo(function ChainOfThought({
  text,
  defaultOpen = false,
}: ChainOfThoughtProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const steps = splitIntoSteps(text);
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return (
    <div className="cot-root">
      {/* Header / toggle */}
      <button
        className="cot-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="cot-header-icon">
          <Brain size={14} strokeWidth={2} />
        </span>
        <span className="cot-header-title">Cadeia de raciocínio</span>
        <span className="cot-header-meta">
          {steps.length} {steps.length === 1 ? "passo" : "passos"} · {wordCount} palavras
        </span>
        <span className="cot-header-chevron">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>

      {/* Animated body */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="cot-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.65, 0.3, 0.9] }}
          >
            <div className="cot-steps">
              {steps.map((step, i) => (
                <StepCard key={step.id} step={step} index={i} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
