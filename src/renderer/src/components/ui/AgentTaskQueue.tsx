/**
 * AgentTaskQueue — visual task queue / agent plan visualizer.
 *
 * Parses structured task lists from assistant messages and renders them
 * as an interactive queue with status icons and animated transitions.
 * Supports pending / running / done / error states.
 */
import { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Circle,
  CircleDotDashed,
  CheckCircle2,
  CircleX,
  ChevronDown,
  ChevronRight,
  ListTodo,
  Clock,
} from "lucide-react";

/* ── Types ─────────────────────────────────────────────────────────────── */

export type TaskStatus = "pending" | "running" | "done" | "error" | "skipped";

export interface TaskItem {
  id: string;
  label: string;
  status: TaskStatus;
  detail?: string;
  subtasks?: TaskItem[];
  durationMs?: number;
}

interface AgentTaskQueueProps {
  tasks: TaskItem[];
  title?: string;
  defaultOpen?: boolean;
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function statusIcon(status: TaskStatus): React.ReactElement {
  const p = { size: 14, strokeWidth: 2.2 };
  switch (status) {
    case "done":    return <CheckCircle2 {...p} />;
    case "error":   return <CircleX {...p} />;
    case "running": return <CircleDotDashed {...p} />;
    case "skipped": return <Circle {...p} />;
    default:        return <Circle {...p} />;
  }
}

function statusLabel(status: TaskStatus): string {
  switch (status) {
    case "done":    return "done";
    case "error":   return "error";
    case "running": return "running";
    case "skipped": return "skipped";
    default:        return "pending";
  }
}

function countDone(tasks: TaskItem[]): number {
  return tasks.filter((t) => t.status === "done").length;
}

/* ── Single task row ───────────────────────────────────────────────────── */

const TaskRow = memo(function TaskRow({
  task,
  depth = 0,
}: {
  task: TaskItem;
  depth?: number;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = !!task.subtasks && task.subtasks.length > 0;
  const hasDetail = !!task.detail;
  const isExpandable = hasChildren || hasDetail;

  const duration =
    task.durationMs !== undefined
      ? task.durationMs < 1000
        ? `${task.durationMs}ms`
        : `${(task.durationMs / 1000).toFixed(1)}s`
      : null;

  return (
    <motion.div
      className="atq-task-wrap"
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      style={{ paddingLeft: depth * 16 }}
    >
      <div className={`atq-task atq-task--${statusLabel(task.status)}`}>
        <span className="atq-status-icon">{statusIcon(task.status)}</span>
        <span className="atq-label">{task.label}</span>
        {duration && (
          <span className="atq-duration">
            <Clock size={10} strokeWidth={2} />
            {duration}
          </span>
        )}
        {isExpandable && (
          <button
            className="atq-expand-btn"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Ocultar detalhes" : "Ver detalhes"}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {expanded && isExpandable && (
          <motion.div
            className="atq-expand-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {hasDetail && <p className="atq-detail">{task.detail}</p>}
            {hasChildren &&
              task.subtasks!.map((sub) => (
                <TaskRow key={sub.id} task={sub} depth={depth + 1} />
              ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

/* ── Main component ────────────────────────────────────────────────────── */

export const AgentTaskQueue = memo(function AgentTaskQueue({
  tasks,
  title = "Plano de execução",
  defaultOpen = true,
}: AgentTaskQueueProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const done = countDone(tasks);
  const total = tasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="atq-root">
      {/* Header */}
      <button
        className="atq-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ListTodo size={14} strokeWidth={2} />
        <span className="atq-header-title">{title}</span>
        <span className="atq-header-progress">
          {done}/{total} · {pct}%
        </span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>

      {/* Progress bar */}
      <div className="atq-progress-track">
        <motion.div
          className="atq-progress-fill"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </div>

      {/* Tasks list */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="atq-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.65, 0.3, 0.9] }}
          >
            <div className="atq-list">
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

/* ── Utility: parse markdown task lists into TaskItem[] ────────────────── */

/**
 * Parses markdown-style task lists from assistant messages.
 * Matches: `- [ ] pending`, `- [x] done`, `- [~] running`, `- [!] error`
 */
export function parseTaskList(text: string): TaskItem[] {
  const lines = text.split("\n");
  const tasks: TaskItem[] = [];
  let idCounter = 0;

  for (const line of lines) {
    // Match: - [ ] label, - [x] label, - [X] label, - [~] label, - [!] label
    const m = line.match(/^\s*[-*]\s+\[([x Xx~!])\]\s+(.+)$/);
    if (!m) continue;
    const marker = m[1].toLowerCase();
    const label = m[2].trim();
    let status: TaskStatus = "pending";
    if (marker === "x") status = "done";
    else if (marker === "~") status = "running";
    else if (marker === "!") status = "error";
    else if (marker === " ") status = "pending";

    tasks.push({ id: String(idCounter++), label, status });
  }

  return tasks;
}
