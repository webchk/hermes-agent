/**
 * FilesModifiedTracker — Souza/JS.
 *
 * Derives the list of files the agent has read / written / edited in the
 * current chat from the live ActivityFeed entries. Renders as a compact
 * chip row below the chat header so the user can see at a glance what's
 * being touched without scrolling through tool cards.
 *
 * Click a chip → opens the file in the OS default app (Quick Look style
 * for images, editor for code) via `hermesAPI.openExternal("file://...")`.
 */
import { memo, useMemo } from "react";
import { FileText, Pencil, Trash2, Eye } from "lucide-react";
import type { ActivityEntry, ToolActivityEntry } from "../hooks/useActivityFeed";

type FileOp = "read" | "write" | "edit" | "delete";

interface FileTouch {
  path: string;
  op: FileOp;
  /** Last seen status — used to dim completed entries slightly. */
  status: "running" | "completed" | "error";
}

const READ_TOOLS = /(^|_)(read|cat|view|ls|get|fetch_file)(_|$)/i;
const WRITE_TOOLS = /(^|_)(write|create|save|new)(_|$)/i;
const EDIT_TOOLS = /(^|_)(edit|patch|replace|update|modify|apply)(_|$)/i;
const DELETE_TOOLS = /(^|_)(delete|remove|rm|unlink)(_|$)/i;

const PATH_PATTERNS = [
  /"(?:file_?path|path|file|filename|target|filepath)"\s*:\s*"([^"]+)"/i,
  /'(?:file_?path|path|file|filename|target|filepath)'\s*:\s*'([^']+)'/i,
  /\b\/[A-Za-z0-9._\-/~]+\.[A-Za-z0-9]{1,8}\b/, // bare absolute path with extension
];

function classifyOp(toolName: string): FileOp | null {
  if (DELETE_TOOLS.test(toolName)) return "delete";
  if (EDIT_TOOLS.test(toolName)) return "edit";
  if (WRITE_TOOLS.test(toolName)) return "write";
  if (READ_TOOLS.test(toolName)) return "read";
  return null;
}

function extractPath(entry: ToolActivityEntry): string | null {
  const haystack = [
    typeof entry.args === "string" ? entry.args : JSON.stringify(entry.args || ""),
    entry.label || "",
  ].join(" ");
  for (const re of PATH_PATTERNS) {
    const m = re.exec(haystack);
    if (m) return m[1] || m[0];
  }
  return null;
}

function shortPath(p: string, max = 36): string {
  if (p.length <= max) return p;
  const parts = p.split("/");
  if (parts.length <= 2) return "…" + p.slice(-(max - 1));
  const head = parts[0] === "" ? "/" + parts[1] : parts[0];
  const tail = parts.slice(-2).join("/");
  const composed = `${head}/…/${tail}`;
  return composed.length <= max ? composed : "…" + tail.slice(-(max - 1));
}

function iconFor(op: FileOp): typeof FileText {
  if (op === "read") return Eye;
  if (op === "write") return FileText;
  if (op === "edit") return Pencil;
  return Trash2;
}

export const FilesModifiedTracker = memo(function FilesModifiedTracker({
  entries,
}: {
  entries: ActivityEntry[];
}): React.JSX.Element | null {
  const files = useMemo<FileTouch[]>(() => {
    const seen = new Map<string, FileTouch>();
    for (const entry of entries) {
      if (entry.kind !== "tool") continue;
      const op = classifyOp(entry.tool);
      if (!op) continue;
      const path = extractPath(entry);
      if (!path) continue;
      const key = `${op}::${path}`;
      // Keep the most "advanced" status (running < completed < error)
      const existing = seen.get(key);
      const status =
        entry.status === "error"
          ? "error"
          : entry.status === "completed"
            ? "completed"
            : "running";
      if (!existing) {
        seen.set(key, { path, op, status });
      } else if (status === "error") {
        existing.status = "error";
      } else if (existing.status === "running" && status === "completed") {
        existing.status = "completed";
      }
    }
    // Show edits/writes first (more interesting), then reads, then deletes
    const order: Record<FileOp, number> = { edit: 0, write: 1, read: 2, delete: 3 };
    return [...seen.values()].sort((a, b) => order[a.op] - order[b.op]);
  }, [entries]);

  if (files.length === 0) return null;

  return (
    <div className="files-tracker" role="region" aria-label="Arquivos tocados">
      <span className="files-tracker-label">Arquivos:</span>
      <div className="files-tracker-list">
        {files.map((f) => {
          const Icon = iconFor(f.op);
          return (
            <button
              key={`${f.op}-${f.path}`}
              type="button"
              className={`file-chip file-chip-${f.op} file-chip-${f.status}`}
              onClick={() => {
                try {
                  window.hermesAPI.openExternal(`file://${f.path}`);
                } catch {
                  /* ignore */
                }
              }}
              title={`${f.op === "read" ? "Lido" : f.op === "write" ? "Criado" : f.op === "edit" ? "Editado" : "Removido"}: ${f.path}`}
            >
              <Icon size={11} strokeWidth={2.2} />
              <span className="file-chip-path">{shortPath(f.path)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
});
