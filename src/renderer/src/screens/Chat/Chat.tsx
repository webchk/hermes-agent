import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ChatHeader } from "./ChatHeader";
import { ChatEmptyState } from "./ChatEmptyState";
import { MessageList } from "./MessageList";
import { ModelPicker } from "./ModelPicker";
import { useChatScroll } from "./hooks/useChatScroll";
import { useChatIPC } from "./hooks/useChatIPC";
import { useChatActions } from "./hooks/useChatActions";
import { useModelConfig } from "./hooks/useModelConfig";
import { useFastMode } from "./hooks/useFastMode";
import { useLocalCommands } from "./hooks/useLocalCommands";
import { useActivityFeed } from "../../hooks/useActivityFeed";
import { RuntimeStatusBar } from "../../components/RuntimeStatusBar";
import { FilesModifiedTracker } from "../../components/FilesModifiedTracker";
import { useI18n } from "../../components/useI18n";
import { buildChatTranscript } from "./transcriptUtils";
import type { ChatMessage, UsageState } from "./types";

export type { ChatMessage } from "./types";

interface ChatProps {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  sessionId: string | null;
  profile?: string;
  onSessionStarted?: () => void;
  onNewChat?: () => void;
}

function Chat({
  messages,
  setMessages,
  sessionId,
  profile,
  onSessionStarted,
  onNewChat,
}: ChatProps): React.JSX.Element {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(false);
  const [hermesSessionId, setHermesSessionId] = useState<string | null>(null);
  const [toolProgress, setToolProgress] = useState<string | null>(null);
  // Souza/JS: structured activity feed (tool lifecycle, reasoning, etc.).
  const {
    entries: activityEntries,
    clear: clearActivity,
    pushDivider: pushActivityDivider,
    replaceAll: replaceActivityAll,
  } = useActivityFeed();
  const [activityTick, setActivityTick] = useState(0);
  // Track loading start time for elapsed-time-based phase display in ActivityFeed.
  const [loadingStartTime, setLoadingStartTime] = useState<number | null>(null);
  // Per-session activity snapshot — keeps feed visible when switching sessions.
  const sessionActivitiesRef = useRef<Map<string | null, import("../../hooks/useActivityFeed").ActivityEntry[]>>(new Map());
  const activityEntriesRef = useRef(activityEntries);
  useEffect(() => { activityEntriesRef.current = activityEntries; });
  useEffect(() => {
    // Drive tick while loading OR while real tool entries are running.
    // isLoading drives the elapsed-time phase transitions (sending → thinking).
    // hasRunning drives the live duration counter on running tool rows.
    const hasRunning = activityEntries.some(
      (e) => e.kind === "tool" && e.status === "running",
    );
    if (!hasRunning && !isLoading) return;
    const id = setInterval(() => setActivityTick((t) => t + 1), 200);
    return () => clearInterval(id);
  }, [activityEntries, isLoading]);

  // Souza/JS: PREVIOUSLY this hook cleared the activity feed on every new
  // user turn. User feedback (2026-05-24): "quando faco outra pergunta o
  // feedback antigo ele some". So instead of clearing, we push a visual
  // divider into the feed — full history stays visible with clear markers.
  const lastMsg = messages[messages.length - 1] as
    | { id: string; role?: string; kind?: string; content?: unknown }
    | undefined;
  const lastMsgId = lastMsg?.id;
  const lastMsgIsUser =
    !!lastMsg &&
    (lastMsg.role === "user" ||
      (lastMsg as { role?: string }).role === "user-btw" ||
      (lastMsg as { role?: string }).role === "user-approve" ||
      (lastMsg as { role?: string }).role === "user-deny");
  useEffect(() => {
    if (lastMsgIsUser) {
      // Short label: first 40 chars of the user message (if string-like).
      let label = "Nova pergunta";
      const c = (lastMsg as { content?: unknown }).content;
      if (typeof c === "string") {
        const clean = c.replace(/\s+/g, " ").trim();
        if (clean) label = clean.length > 40 ? clean.slice(0, 40) + "…" : clean;
      }
      pushActivityDivider(label);
    }
  }, [lastMsgId, lastMsgIsUser, lastMsg, pushActivityDivider]);

  // Souza/JS: Plan Mode — when ON the user's prompt is prefixed with an
  // instruction to outline the plan and wait for approval before executing.
  // Toggle persists in localStorage so the choice survives reloads.
  const [planMode, setPlanModeState] = useState<boolean>(() => {
    try {
      return localStorage.getItem("hermes-plan-mode") === "1";
    } catch {
      return false;
    }
  });
  const togglePlanMode = useCallback(() => {
    setPlanModeState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("hermes-plan-mode", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // handleSendWithPlan is defined AFTER `actions` further down to avoid
  // use-before-declaration.
  const [usage, setUsage] = useState<UsageState | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [remoteMode, setRemoteMode] = useState(false);
  // Working folder bound to this conversation (issue #27). Per-conversation,
  // held in memory; reset on session switch / new chat below.
  const [contextFolder, setContextFolder] = useState<string | null>(null);
  const dragCounter = useRef(0);
  const chatInputRef = useRef<ChatInputHandle>(null);

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      const flag = await window.hermesAPI.isRemoteMode();
      if (!cancelled) setRemoteMode(flag);
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  const { containerRef, bottomRef } = useChatScroll(messages);
  const modelConfig = useModelConfig(profile);
  const {
    fastMode,
    toggle: toggleFastMode,
    set: setFastTier,
  } = useFastMode(profile);

  useChatIPC({
    setMessages,
    setHermesSessionId,
    setToolProgress,
    setIsLoading: useCallback((loading: boolean) => {
      setIsLoading(loading);
      if (loading) setLoadingStartTime(Date.now());
      else setLoadingStartTime(null);
    }, []),
    setUsage,
  });

  // Reset hermes session when the parent clears messages (new chat).
  // Effect-driven sync because `messages` is owned by the parent; a key-based
  // remount would discard unrelated local state (model picker, etc.).
  useEffect(() => {
    if (messages.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHermesSessionId(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setContextFolder(null);
    }
  }, [messages]);

  // When the parent swaps to a different session, sync local state to it:
  // the gateway session id (a stale one resumes/deletes the WRONG session —
  // issue #276) and the per-conversation context folder (issue #27). Chat is
  // not remounted on session switch, so this must be done explicitly.
  // Activity feed is SAVED per-session and RESTORED on switch — so the user
  // can switch between conversations and see each session's tool history.
  const prevSessionIdRef = useRef<string | null>(sessionId);
  useEffect(() => {
    const prevId = prevSessionIdRef.current;
    if (prevId !== sessionId) {
      // Save outgoing session's activity
      sessionActivitiesRef.current.set(prevId, [...activityEntriesRef.current]);
      // Restore incoming session's activity (or clear if none saved)
      const saved = sessionActivitiesRef.current.get(sessionId);
      if (saved && saved.length > 0) {
        replaceActivityAll(saved);
      } else {
        clearActivity();
      }
      prevSessionIdRef.current = sessionId;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHermesSessionId(sessionId);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContextFolder(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToolProgress(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(false);
    setLoadingStartTime(null);
  // clearActivity and replaceActivityAll are stable; omitting from dep array.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Cmd/Ctrl+N → new chat
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        onNewChat?.();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNewChat]);

  // "Copy entire chat" context-menu items (issue #298) — serialise the whole
  // conversation in the requested format and copy it. A ref keeps the latest
  // messages without re-registering the IPC listener on every chunk.
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  });
  useEffect(() => {
    return window.hermesAPI.onContextMenuCopyChat((format) => {
      const msgs = messagesRef.current;
      if (msgs.length === 0) return;
      void window.hermesAPI.copyToClipboard(buildChatTranscript(msgs, format));
    });
  }, []);

  // "Select All" on a message (issue #298): the native selectAll role would
  // select the entire window, so scope it to the .chat-bubble under the
  // cursor — the user can then Copy that message.
  useEffect(() => {
    return window.hermesAPI.onContextMenuSelectBubble(({ x, y }) => {
      const bubble = document.elementFromPoint(x, y)?.closest(".chat-bubble");
      if (!bubble) return;
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.selectAllChildren(bubble);
    });
  }, []);

  const addAgentMessage = useCallback(
    (content: string) => {
      setMessages((prev) => [
        ...prev,
        { id: `agent-local-${Date.now()}`, role: "agent", content },
      ]);
    },
    [setMessages],
  );

  const handleClear = useCallback(() => {
    if (isLoading) {
      window.hermesAPI.abortChat();
      setIsLoading(false);
    }
    const idToDelete = hermesSessionId ?? sessionId;
    if (idToDelete) {
      void window.hermesAPI.deleteSession(idToDelete);
      void window.hermesAPI.clearStagedAttachments(idToDelete);
    }
    setMessages([]);
    setHermesSessionId(null);
    setContextFolder(null);
    setUsage(null);
    setToolProgress(null);
    clearActivity();
  }, [isLoading, hermesSessionId, sessionId, setMessages, clearActivity]);

  const localCommands = useLocalCommands({
    profile,
    usage,
    setFastMode: setFastTier,
    onNewChat,
    onClear: handleClear,
    addAgentMessage,
  });

  const actions = useChatActions({
    profile,
    hermesSessionId,
    messages,
    isLoading,
    setIsLoading,
    setMessages,
    onSessionStarted,
    chatInputRef,
    localCommands,
    contextFolder,
  });

  // Souza/JS: handleSendWithPlan — prepends Plan Mode instruction when ON.
  // Slash commands bypass the prefix so /clear, /new, /btw stay functional.
  const handleSendWithPlan = useCallback(
    async (
      text: string,
      attachments?: Parameters<typeof actions.handleSend>[1],
    ): Promise<void> => {
      const trimmed = text.trim();
      const isSlashCmd = trimmed.startsWith("/");
      const effectiveText =
        planMode && !isSlashCmd && trimmed.length > 0
          ? `[Plan Mode] Antes de executar qualquer ação, apresente um plano numerado, liste arquivos que vai tocar e comandos que vai rodar. Aguarde minha aprovação ('aprovar', 'pode seguir', 'ok') antes de mexer em qualquer coisa.\n\n${text}`
          : text;
      return actions.handleSend(effectiveText, attachments);
    },
    [planMode, actions],
  );

  // -------------------------------------------------------------------------
  // Souza/JS — Message Queue (paralelismo do user POV)
  // -------------------------------------------------------------------------
  // O agente Hermes é single-turn por sessão. Mas o user quer poder digitar
  // várias perguntas enquanto o agente trabalha. Implementação: as mensagens
  // extras vão para uma fila local; quando o turn anterior termina
  // (isLoading=false), a próxima da fila é despachada automaticamente.
  type QueuedMessage = {
    id: string;
    text: string;
    attachments: Parameters<typeof actions.handleSend>[1];
  };
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
  const isLoadingRef = useRef(isLoading);
  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  const enqueueOrSend = useCallback(
    async (
      text: string,
      attachments?: Parameters<typeof actions.handleSend>[1],
    ): Promise<void> => {
      if (isLoadingRef.current) {
        // Agente ocupado — adiciona à fila e sai.
        setMessageQueue((prev) => [
          ...prev,
          {
            id: `qmsg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            text,
            attachments,
          },
        ]);
        return;
      }
      // Caminho normal: aplica Plan Mode wrapper e despacha.
      return handleSendWithPlan(text, attachments);
    },
    [handleSendWithPlan],
  );

  // Drena a fila quando o agente termina o turn anterior.
  useEffect(() => {
    if (isLoading) return;
    if (messageQueue.length === 0) return;
    const next = messageQueue[0];
    setMessageQueue((prev) => prev.slice(1));
    // Despacha de forma assíncrona — não bloqueia o render.
    void handleSendWithPlan(next.text, next.attachments);
  }, [isLoading, messageQueue, handleSendWithPlan]);

  const clearMessageQueue = useCallback(() => {
    setMessageQueue([]);
  }, []);
  // -------------------------------------------------------------------------

  const handleSuggestion = useCallback((text: string) => {
    chatInputRef.current?.setText(text);
  }, []);

  const handlePickFolder = useCallback(async () => {
    const path = await window.hermesAPI.selectFolder();
    if (path) setContextFolder(path);
  }, []);

  const handleClearFolder = useCallback(() => {
    setContextFolder(null);
  }, []);

  // Drag-and-drop: filter for dragenter events carrying files (suppresses
  // text-drag noise from the textarea autocomplete and other in-app drags).
  const eventHasFiles = useCallback((e: React.DragEvent): boolean => {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === "Files") return true;
    }
    return false;
  }, []);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!eventHasFiles(e)) return;
      e.preventDefault();
      dragCounter.current += 1;
      if (dragCounter.current === 1) setDragActive(true);
    },
    [eventHasFiles],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!eventHasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    },
    [eventHasFiles],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!eventHasFiles(e)) return;
      e.preventDefault();
      dragCounter.current = 0;
      setDragActive(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      void chatInputRef.current?.addFiles(files);
    },
    [eventHasFiles],
  );

  return (
    <div
      className="chat-container"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ChatHeader
        sessionId={sessionId}
        sessionTitle={useMemo(() => {
          const first = messages.find((m) => m.role === "user" && "content" in m);
          const text = first && "content" in first ? (first as { content: string }).content : "";
          const clean = text
            .replace(/```[\s\S]*?```/g, " ")
            .replace(/`[^`]*`/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          const words = clean.split(" ").filter(Boolean);
          let title = "";
          for (const word of words) {
            if ((title + " " + word).trim().length > 50) break;
            title = (title + " " + word).trim();
          }
          return title || clean.slice(0, 50) || null;
        }, [messages])}
        usage={usage}
        fastMode={fastMode}
        hasMessages={messages.length > 0}
        contextFolder={contextFolder}
        showContextFolder={!remoteMode}
        onPickFolder={handlePickFolder}
        onClearFolder={handleClearFolder}
        onToggleFast={toggleFastMode}
        onNewChat={onNewChat}
        onClear={handleClear}
      />

      <div className="chat-messages" ref={containerRef}>
        {messages.length === 0 ? (
          <ChatEmptyState onSelectSuggestion={handleSuggestion} />
        ) : (
          <MessageList
            messages={messages}
            isLoading={isLoading}
            toolProgress={toolProgress}
            activityEntries={activityEntries}
            activityTick={activityTick}
            loadingStartTime={loadingStartTime}
            onApprove={actions.handleApprove}
            onDeny={actions.handleDeny}
          />
        )}
        <div ref={bottomRef} />
      </div>

      {/* Souza/JS: files modified strip — derived from activity entries.
          Hidden when there's nothing to show so it doesn't take height. */}
      <FilesModifiedTracker entries={activityEntries} />

      {/* Souza/JS: footer status strip (model, conn, tokens, state, plan mode) */}
      <RuntimeStatusBar
        connectionMode={remoteMode ? "remote" : "local"}
        gatewayHealthy={true}
        model={modelConfig.displayModel || modelConfig.currentModel}
        usage={usage}
        isLoading={isLoading}
        planMode={planMode}
      />

      <div className="chat-input-area">
        <div className="chat-input-toolbar">
          <button
            type="button"
            className={`plan-mode-toggle ${planMode ? "plan-mode-on" : ""}`}
            onClick={togglePlanMode}
            title={
              planMode
                ? "Plan Mode ATIVO: agente apresenta plano antes de executar. Clique para desligar."
                : "Auto Mode: agente executa direto. Clique para ativar Plan Mode (revisão antes de executar)."
            }
          >
            {planMode ? "🛡️ Plan Mode" : "⚡ Auto Mode"}
          </button>
        </div>
        {/* Souza/JS: indicador da fila de mensagens. Aparece quando há
            perguntas em espera (user digitou enquanto agente trabalhava). */}
        {messageQueue.length > 0 && (
          <div
            className="message-queue-indicator"
            title={`${messageQueue.length} pergunta(s) em fila — serão enviadas automaticamente após o agente terminar.`}
          >
            <span className="queue-badge">{messageQueue.length}</span>
            <span className="queue-label">
              {messageQueue.length === 1
                ? "1 pergunta na fila"
                : `${messageQueue.length} perguntas na fila`}
            </span>
            <button
              type="button"
              className="queue-clear-btn"
              onClick={clearMessageQueue}
              title="Cancelar fila"
            >
              Cancelar
            </button>
          </div>
        )}
        <ChatInput
          ref={chatInputRef}
          isLoading={isLoading}
          inputAlwaysEnabled
          hasSession={!!hermesSessionId}
          sessionId={hermesSessionId}
          remoteMode={remoteMode}
          onSubmit={enqueueOrSend}
          onQuickAsk={actions.handleQuickAsk}
          onAbort={actions.handleAbort}
        />
        <ModelPicker
          currentModel={modelConfig.currentModel}
          currentProvider={modelConfig.currentProvider}
          currentBaseUrl={modelConfig.currentBaseUrl}
          modelGroups={modelConfig.modelGroups}
          displayModel={modelConfig.displayModel}
          onOpen={modelConfig.reload}
          onSelectModel={modelConfig.selectModel}
        />
      </div>
      {dragActive && (
        <div className="chat-drop-overlay" aria-hidden>
          <div className="chat-drop-overlay-inner">
            {t("chat.dropToAttach")}
          </div>
        </div>
      )}
    </div>
  );
}

export default Chat;
