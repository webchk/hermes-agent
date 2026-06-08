/**
 * useActivityFeed — Souza/JS, see ~/Documents/hermes-realtime-feedback.md.
 *
 * Subscribes to `chat-tool-event` IPC channel and accumulates structured
 * tool lifecycle events. `running` events create new entries; `completed`
 * and `error` events update the matching toolCallId entry in place.
 *
 * Souza/JS update: feed is NO LONGER cleared between turns. Instead, the
 * consumer (Chat.tsx) calls `pushDivider(label)` when a new user turn
 * begins, so the entire session history stays visible with clear markers.
 * `clear()` still exists for full resets (session switch, /clear command).
 */
import { useEffect, useState, useCallback } from "react";

export interface ToolActivityEntry {
  kind: "tool";
  toolCallId: string;
  tool: string;
  label?: string;
  emoji?: string;
  args?: unknown;
  result?: string;
  status: "running" | "completed" | "error";
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
}

export interface DividerEntry {
  kind: "divider";
  id: string;
  label: string;
  at: number;
}

export type ActivityEntry = ToolActivityEntry | DividerEntry;

interface ChatToolEvent {
  toolCallId: string;
  tool: string;
  status: "running" | "completed" | "error";
  label?: string;
  emoji?: string;
  args?: unknown;
  result?: string;
  durationMs?: number;
  receivedAt: number;
}

let _dividerSeq = 0;

export function useActivityFeed(): {
  entries: ActivityEntry[];
  clear: () => void;
  pushDivider: (label: string) => void;
  replaceAll: (entries: ActivityEntry[]) => void;
} {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    const off = window.hermesAPI.onChatToolEvent((raw) => {
      // Defensive: preload type cast lands here as ChatToolEvent
      const evt = raw as ChatToolEvent;
      if (!evt || typeof evt !== "object" || !evt.tool) return;

      setEntries((current) => {
        const key = evt.toolCallId || `${evt.tool}:${evt.receivedAt}`;
        const existingIdx = current.findIndex(
          (e) =>
            e.kind === "tool" &&
            (e.toolCallId || `${e.tool}:${e.startedAt}`) === key,
        );

        if (evt.status === "running") {
          if (existingIdx >= 0) return current; // already tracked
          return [
            ...current,
            {
              kind: "tool",
              toolCallId: evt.toolCallId,
              tool: evt.tool,
              label: evt.label,
              emoji: evt.emoji,
              args: evt.args,
              status: "running",
              startedAt: evt.receivedAt,
            } satisfies ToolActivityEntry,
          ];
        }

        // completed | error — update in place
        if (existingIdx < 0) {
          // We never saw the "running" start (filtered or out of order).
          // Append as a terminal entry so the user still sees feedback.
          return [
            ...current,
            {
              kind: "tool",
              toolCallId: evt.toolCallId,
              tool: evt.tool,
              label: evt.label,
              emoji: evt.emoji,
              args: evt.args,
              result: evt.result,
              status: evt.status,
              startedAt: evt.receivedAt,
              completedAt: evt.receivedAt,
              durationMs: evt.durationMs,
            } satisfies ToolActivityEntry,
          ];
        }

        const updated = [...current];
        const prev = updated[existingIdx] as ToolActivityEntry;
        updated[existingIdx] = {
          ...prev,
          status: evt.status,
          result: evt.result ?? prev.result,
          completedAt: evt.receivedAt,
          durationMs:
            evt.durationMs ??
            (prev.startedAt ? evt.receivedAt - prev.startedAt : undefined),
        };
        return updated;
      });
    });

    return off;
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  const replaceAll = useCallback((newEntries: ActivityEntry[]) => {
    setEntries(newEntries);
  }, []);

  const pushDivider = useCallback((label: string) => {
    setEntries((current) => {
      // Dedup: if the last entry is already an identical divider, skip.
      const last = current[current.length - 1];
      if (last && last.kind === "divider" && last.label === label) {
        return current;
      }
      _dividerSeq += 1;
      return [
        ...current,
        {
          kind: "divider",
          id: `div-${Date.now()}-${_dividerSeq}`,
          label,
          at: Date.now(),
        } satisfies DividerEntry,
      ];
    });
  }, []);

  return { entries, clear, pushDivider, replaceAll };
}
