import { memo, useMemo } from "react";
import { HermesAvatar, MessageRow } from "./MessageRow";
import { ReasoningRow, ToolCallRow, ToolResultRow } from "./HistoryRow";
import { ActivityFeed } from "../../components/ActivityFeed";
import { ActivityErrorBoundary } from "../../components/ActivityErrorBoundary";
import type { ActivityEntry } from "../../hooks/useActivityFeed";
import type { ChatMessage } from "./types";

// Souza/JS: synthetic phase markers injected around real tool events so the
// UI shows progressive loading phases while the LLM works:
//   "Enviando..." → "Processando..." → tool events → "Gerando resposta..." → "Concluído"
const SYNTH_SENDING_ID = "__synth_sending__";
const SYNTH_THINKING_ID = "__synth_thinking__";
const SYNTH_STREAMING_ID = "__synth_streaming__";
const SYNTH_DONE_ID = "__synth_done__";

function buildDisplayEntries(
  entries: ActivityEntry[],
  isLoading: boolean,
  hasStreamingContent: boolean,
  loadingStartTime: number | null,
): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  const anyRunning = entries.some(
    (e) => e.kind === "tool" && e.status === "running",
  );
  const hasRealToolEntries = entries.some((e) => e.kind === "tool");

  // Real entries FIRST so chronological order is preserved.
  // Synthetic loading indicator is appended AFTER so it appears at the bottom,
  // not above completed tool rows.
  out.push(...entries);

  if (isLoading && !anyRunning) {
    const elapsedMs = loadingStartTime ? Date.now() - loadingStartTime : 0;

    if (hasStreamingContent) {
      // Model is streaming text — show generating state
      out.push({
        kind: "tool",
        toolCallId: SYNTH_STREAMING_ID,
        tool: "streaming",
        label: "Escrevendo resposta em tempo real",
        status: "running",
        startedAt: loadingStartTime ?? Date.now(),
      });
    } else if (elapsedMs < 1500 && !hasRealToolEntries) {
      // Very early — request just sent
      out.push({
        kind: "tool",
        toolCallId: SYNTH_SENDING_ID,
        tool: "sending",
        label: "Processando sua solicitação",
        status: "running",
        startedAt: loadingStartTime ?? Date.now(),
      });
    } else {
      // Waiting for model to respond / analyze context
      out.push({
        kind: "tool",
        toolCallId: SYNTH_THINKING_ID,
        tool: "thinking",
        label: "Lendo arquivos · Verificando dependências · Elaborando resposta",
        status: "running",
        startedAt: loadingStartTime ?? Date.now(),
      });
    }
  }

  // Show SYNTH_DONE whenever loading ends AND there's any prior activity
  // (divider or real tool). This ensures persistence even for simple chat
  // turns with no tool calls.
  const lastTool = [...entries]
    .reverse()
    .find((e): e is import("../../hooks/useActivityFeed").ToolActivityEntry => e.kind === "tool");
  const lastDivider = [...entries].reverse().find((e) => e.kind === "divider");
  if (!isLoading && (lastTool || lastDivider)) {
    const ts =
      lastTool?.completedAt ??
      lastTool?.startedAt ??
      (lastDivider as import("../../hooks/useActivityFeed").DividerEntry | undefined)?.at ??
      Date.now();
    out.push({
      kind: "tool",
      toolCallId: SYNTH_DONE_ID,
      tool: "done",
      label: "Todas as ações foram concluídas com sucesso",
      status: "completed",
      startedAt: ts,
      completedAt: ts,
    });
  }

  return out;
}

interface MessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  toolProgress: string | null;
  // Souza/JS: structured activity feed (overrides single toolProgress string).
  activityEntries?: ActivityEntry[];
  activityTick?: number;
  /** Timestamp (Date.now()) when the current loading started, for phase display. */
  loadingStartTime?: number | null;
  onApprove: () => void;
  onDeny: () => void;
}

function TypingIndicator({
  toolProgress,
  activityEntries,
  activityTick,
}: {
  toolProgress: string | null;
  activityEntries?: ActivityEntry[];
  activityTick?: number;
}): React.JSX.Element {
  const hasActivity = !!activityEntries && activityEntries.length > 0;
  return (
    <div className="chat-message chat-message-agent">
      <HermesAvatar />
      <div className="chat-bubble chat-bubble-agent">
        {hasActivity ? (
          <ActivityFeed entries={activityEntries!} tick={activityTick || 0} />
        ) : toolProgress ? (
          <div className="chat-tool-progress">{toolProgress}</div>
        ) : (
          <div className="chat-typing">
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Bubble messages are filtered to "has content". History items (reasoning,
 * tool_call, tool_result) are *always* shown — they're collapsed by default
 * and the user opens them. Filtering them by content would defeat the point.
 */
function isBubble(m: ChatMessage): m is import("./types").ChatBubbleMessage {
  // Bubble messages have no `kind` field (or kind === "user"/"assistant").
  // History items have kind === "reasoning" | "tool_call" | "tool_result".
  const k = (m as { kind?: string }).kind;
  return !k || k === "user" || k === "assistant";
}

export const MessageList = memo(function MessageList({
  messages,
  isLoading,
  toolProgress,
  activityEntries,
  activityTick,
  loadingStartTime,
  onApprove,
  onDeny,
}: MessageListProps): React.JSX.Element {
  // Bubbles with empty content are still hidden (live-stream placeholders).
  // History rows pass through unconditionally.
  const visibleMessages = useMemo(
    () =>
      messages.filter((m) => {
        if (!isBubble(m)) return true;
        return ((m.content as string) || "").trim().length > 0;
      }),
    [messages],
  );

  const lastBubble = [...messages].reverse().find(isBubble);
  const lastMessageIsAgent = !!lastBubble && lastBubble.role === "agent";

  // Souza/JS: Find the index of the last user bubble so we can inject the
  // ActivityFeed BETWEEN it and the agent's response (Claude Code order:
  // user → tool activity → agent answer), instead of dumping the feed
  // after the assistant message.
  const lastUserIdx = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      const m = visibleMessages[i];
      if (isBubble(m) && m.role === "user") return i;
    }
    return -1;
  }, [visibleMessages]);

  const renderMessage = (
    msg: ChatMessage,
    i: number,
  ): React.JSX.Element | null => {
    const k = (msg as { kind?: string }).kind;
    if (k === "reasoning") {
      return (
        <ReasoningRow
          key={msg.id}
          msg={msg as Extract<ChatMessage, { kind: "reasoning" }>}
        />
      );
    }
    if (k === "tool_call") {
      return (
        <ToolCallRow
          key={msg.id}
          msg={msg as Extract<ChatMessage, { kind: "tool_call" }>}
        />
      );
    }
    if (k === "tool_result") {
      return (
        <ToolResultRow
          key={msg.id}
          msg={msg as Extract<ChatMessage, { kind: "tool_result" }>}
        />
      );
    }
    const bubble = msg as Extract<ChatMessage, { role: "user" | "agent" }>;
    return (
      <MessageRow
        key={msg.id}
        msg={bubble}
        isLast={i === visibleMessages.length - 1}
        isLoading={isLoading}
        onApprove={onApprove}
        onDeny={onDeny}
      />
    );
  };

  // Detect streaming: the last agent bubble is being built (has content while loading).
  const lastAgentContent = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      const m = visibleMessages[i];
      if (isBubble(m) && m.role === "agent") return (m.content as string) || "";
    }
    return "";
  }, [visibleMessages]);
  const hasStreamingContent = isLoading && lastAgentContent.length > 0;

  const realEntries = activityEntries || [];
  const displayEntries = useMemo(
    () => buildDisplayEntries(realEntries, isLoading, hasStreamingContent, loadingStartTime ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [realEntries, isLoading, hasStreamingContent, loadingStartTime, activityTick],
  );
  const hasActivity = displayEntries.length > 0;

  // Split the message list at the last user message so the feed slots
  // in between. If there's no user message yet, the feed (if any) goes
  // before everything (uncommon, only mid-system bootstrap).
  const beforeFeed = lastUserIdx >= 0 ? visibleMessages.slice(0, lastUserIdx + 1) : [];
  const afterFeed = lastUserIdx >= 0 ? visibleMessages.slice(lastUserIdx + 1) : visibleMessages;

  return (
    <>
      {beforeFeed.map((msg, i) => renderMessage(msg, i))}

      {/* ActivityFeed renders BETWEEN user and assistant. Persists after
          stream — only cleared on new chat / clear button. Wrapped in an
          error boundary so a malformed event can't take down the chat. */}
      {hasActivity && (
        <div
          className={
            isLoading
              ? "chat-activity-inline chat-activity-live"
              : "chat-activity-inline chat-activity-persisted"
          }
        >
          <ActivityErrorBoundary label="ActivityFeed">
            <ActivityFeed entries={displayEntries} tick={activityTick || 0} />
          </ActivityErrorBoundary>
        </div>
      )}

      {/* Loading typing dots only when no activity yet AND no agent reply yet */}
      {isLoading && !lastMessageIsAgent && !hasActivity && (
        <TypingIndicator
          toolProgress={toolProgress}
          activityEntries={activityEntries}
          activityTick={activityTick}
        />
      )}

      {afterFeed.map((msg, i) => renderMessage(msg, beforeFeed.length + i))}

      {isLoading && toolProgress && !hasActivity && (
        <div className="chat-tool-progress-inline">{toolProgress}</div>
      )}
    </>
  );
});
