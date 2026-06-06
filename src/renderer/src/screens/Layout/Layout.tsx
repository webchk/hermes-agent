import { useState, useCallback, useEffect } from "react";
import Chat, { ChatMessage } from "../Chat/Chat";
import Sessions from "../Sessions/Sessions";
import Agents from "../Agents/Agents";
import Settings from "../Settings/Settings";
import Workspaces from "../Workspaces/Workspaces";
import Skills from "../Skills/Skills";
import Soul from "../Soul/Soul";
import Memory from "../Memory/Memory";
import Tools from "../Tools/Tools";
import Gateway from "../Gateway/Gateway";
import Office from "../Office/Office";
import Models from "../Models/Models";
import Providers from "../Providers/Providers";
import Schedules from "../Schedules/Schedules";
import Kanban from "../Kanban/Kanban";
import { CodeDashboard } from "../Code/CodeDashboard";
import RemoteNotice from "../../components/RemoteNotice";
import VerifyWarningBanner from "../../components/VerifyWarningBanner";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import hermeslogo from "../../assets/hermes.png";
import {
  ChatBubble,
  Clock,
  Users,
  Settings as SettingsIcon,
  Puzzle,
  Sparkles,
  Brain,
  Wrench,
  Signal,
  Building,
  Layers,
  KeyRound,
  Timer,
  Kanban as KanbanIcon,
  Download,
} from "../../assets/icons";
import {
  BarChart2,
  MessageSquarePlus,
  ListTodo,
  Terminal,
  Plus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "../../components/useI18n";

type AppMode = "chat" | "cowork" | "code";

type View =
  | "workspaces"
  | "chat"
  | "sessions"
  | "agents"
  | "office"
  | "models"
  | "providers"
  | "skills"
  | "soul"
  | "memory"
  | "tools"
  | "schedules"
  | "kanban"
  | "gateway"
  | "settings"
  | "code-dashboard";

interface NavItem { view: View; icon: LucideIcon; label: string }
interface NavGroup { label: string; items: NavItem[] }

const NAV_BY_MODE: Record<AppMode, NavGroup[]> = {
  chat: [
    {
      label: "Chat",
      items: [
        { view: "chat",     icon: ChatBubble,       label: "Chat" },
        { view: "sessions", icon: Clock,             label: "Sessões" },
        { view: "agents",   icon: Users,             label: "Perfis" },
        { view: "memory",   icon: Brain,             label: "Memória" },
      ],
    },
    {
      label: "Configuração",
      items: [
        { view: "models",    icon: Layers,      label: "Modelos" },
        { view: "providers", icon: KeyRound,    label: "Provedores" },
        { view: "settings",  icon: SettingsIcon, label: "Config." },
      ],
    },
  ],
  cowork: [
    {
      label: "Workspace",
      items: [
        { view: "kanban",    icon: KanbanIcon,  label: "Tarefas" },
        { view: "schedules", icon: Timer,       label: "Agendados" },
        { view: "office",    icon: Building,    label: "Agentes" },
        { view: "agents",    icon: Users,       label: "Despacho" },
      ],
    },
    {
      label: "Configuração",
      items: [
        { view: "models",    icon: Layers,       label: "Modelos" },
        { view: "settings",  icon: SettingsIcon, label: "Config." },
      ],
    },
  ],
  code: [
    {
      label: "Desenvolvimento",
      items: [
        { view: "code-dashboard", icon: BarChart2,  label: "Dashboard" },
        { view: "chat",           icon: Terminal,   label: "Nova Sessão" },
        { view: "skills",         icon: Puzzle,     label: "Rotinas" },
        { view: "tools",          icon: Wrench,     label: "Ferramentas" },
      ],
    },
    {
      label: "Avançado",
      items: [
        { view: "soul",      icon: Sparkles, label: "Persona" },
        { view: "gateway",   icon: Signal,   label: "Gateway" },
        { view: "providers", icon: KeyRound, label: "Provedores" },
        { view: "settings",  icon: SettingsIcon, label: "Config." },
      ],
    },
  ],
};

const MODE_PRIMARY_ACTION: Record<AppMode, { label: string; icon: LucideIcon; view: View }> = {
  chat:   { label: "Novo Chat",   icon: MessageSquarePlus, view: "chat" },
  cowork: { label: "Nova Tarefa", icon: ListTodo,          view: "kanban" },
  code:   { label: "Nova Sessão", icon: Plus,              view: "chat" },
};

// Ícones SVG para seletor de modo
const ChatModeIcon = (): React.JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
);

const CoworkModeIcon = (): React.JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
    <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
  </svg>
);

const CodeModeIcon = (): React.JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
  </svg>
);

interface LayoutProps {
  verifyWarning?: boolean;
  onReinstall?: () => void;
  onDismissVerifyWarning?: () => void;
}

function Layout({
  verifyWarning,
  onReinstall,
  onDismissVerifyWarning,
}: LayoutProps = {}): React.JSX.Element {
  const { t } = useI18n();
  const [appMode, setAppMode] = useState<AppMode>("chat");
  const [view, setView] = useState<View>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [activeProfile, setActiveProfile] = useState("default");
  const [visitedViews, setVisitedViews] = useState<Set<View>>(
    () => new Set<View>(["chat"]),
  );
  const [remoteMode, setRemoteMode] = useState(false);

  const paneStyle = (target: View): React.CSSProperties => ({
    display: view === target ? "flex" : "none",
    flex: 1,
    flexDirection: "column",
    overflow: "hidden",
  });

  const goTo = useCallback((v: View) => {
    setVisitedViews((prev) => (prev.has(v) ? prev : new Set(prev).add(v)));
    setView(v);
  }, []);

  useEffect(() => {
    window.hermesAPI.isRemoteOnlyMode().then(setRemoteMode);
  }, [view]);

  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<
    "available" | "downloading" | "ready" | "error" | null
  >(null);
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    const cleanupAvailable = window.hermesAPI.onUpdateAvailable((info) => {
      setUpdateVersion(info.version);
      setUpdateState("available");
      setUpdateError(null);
      setDownloadPercent(0);
    });
    const cleanupProgress = window.hermesAPI.onUpdateDownloadProgress(
      (info) => { setDownloadPercent(info.percent); },
    );
    const cleanupDownloaded = window.hermesAPI.onUpdateDownloaded(() => {
      setUpdateState("ready");
      setUpdateError(null);
    });
    const cleanupError = window.hermesAPI.onUpdateError((message) => {
      setUpdateState("error");
      setUpdateError(message);
      setDownloadPercent(0);
    });
    return () => {
      cleanupAvailable();
      cleanupProgress();
      cleanupDownloaded();
      cleanupError();
    };
  }, []);

  async function handleUpdate(): Promise<void> {
    if (updateState === "available" || updateState === "error") {
      setUpdateError(null);
      setDownloadPercent(0);
      setUpdateState("downloading");
      try {
        const ok = await window.hermesAPI.downloadUpdate();
        if (!ok) setUpdateState("error");
      } catch (err) {
        setUpdateError(err instanceof Error ? err.message : String(err));
        setUpdateState("error");
      }
    } else if (updateState === "ready") {
      await window.hermesAPI.installUpdate();
    }
  }

  const handleNewChat = useCallback(() => {
    window.hermesAPI.abortChat();
    setMessages([]);
    setCurrentSessionId(null);
    goTo("chat");
  }, [goTo]);

  useEffect(() => {
    const cleanupNewChat = window.hermesAPI.onMenuNewChat(() => { handleNewChat(); });
    const cleanupSearch = window.hermesAPI.onMenuSearchSessions(() => { goTo("sessions"); });
    return () => { cleanupNewChat(); cleanupSearch(); };
  }, [handleNewChat, goTo]);

  const handleSelectProfile = useCallback((name: string) => {
    setActiveProfile(name);
    setMessages([]);
    setCurrentSessionId(null);
    window.hermesAPI.setActiveWorkspaceFirewall(name).catch(console.error);
  }, []);

  const handleResumeSession = useCallback(
    async (sessionId: string) => {
      const items = await window.hermesAPI.getSessionMessages(sessionId);
      const chatMessages: ChatMessage[] = items
        .map((it): ChatMessage | null => {
          switch (it.kind) {
            case "user":
              return { id: `db-${it.id}`, role: "user", content: it.content, ...(it.attachments?.length ? { attachments: it.attachments } : {}) };
            case "assistant":
              return { id: `db-${it.id}`, role: "agent", content: it.content, ...(it.attachments?.length ? { attachments: it.attachments } : {}) };
            case "reasoning":
              return { id: `db-r-${it.id}`, kind: "reasoning", role: "agent", text: it.text };
            case "tool_call":
              return { id: `db-tc-${it.id}-${it.callId || "x"}`, kind: "tool_call", role: "agent", callId: it.callId, name: it.name, args: it.args };
            case "tool_result":
              return { id: `db-tr-${it.id}`, kind: "tool_result", role: "agent", callId: it.callId, name: it.name, content: it.content, ...(it.attachments?.length ? { attachments: it.attachments } : {}) };
            default:
              return null;
          }
        })
        .filter((m): m is ChatMessage => m !== null);
      setMessages(chatMessages);
      setCurrentSessionId(sessionId);
      goTo("chat");
    },
    [goTo],
  );

  const handleModeSwitch = useCallback((mode: AppMode) => {
    setAppMode(mode);
    const defaultViews: Record<AppMode, View> = {
      chat: "chat",
      cowork: "kanban",
      code: "code-dashboard",
    };
    goTo(defaultViews[mode]);
  }, [goTo]);

  const primaryAction = MODE_PRIMARY_ACTION[appMode];
  const navGroups = NAV_BY_MODE[appMode];

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src={hermeslogo} height={28} alt="Hermes" />
        </div>

        {/* Seletor de modo Chat / Cowork / Code */}
        <div className="app-mode-switcher">
          <button
            className={`app-mode-tab ${appMode === "chat" ? "active" : ""}`}
            onClick={() => handleModeSwitch("chat")}
          >
            <ChatModeIcon />
            Chat
          </button>
          <button
            className={`app-mode-tab ${appMode === "cowork" ? "active" : ""}`}
            onClick={() => handleModeSwitch("cowork")}
          >
            <CoworkModeIcon />
            Cowork
          </button>
          <button
            className={`app-mode-tab ${appMode === "code" ? "active" : ""}`}
            onClick={() => handleModeSwitch("code")}
          >
            <CodeModeIcon />
            Code
          </button>
        </div>

        {/* Botão de ação primária do modo */}
        <button
          className="sidebar-new-btn"
          onClick={() => {
            if (primaryAction.view === "chat") handleNewChat();
            else goTo(primaryAction.view);
          }}
        >
          <span className="sidebar-new-btn-icon">
            <primaryAction.icon size={12} />
          </span>
          {primaryAction.label}
        </button>

        {/* Workspace switcher */}
        <WorkspaceSwitcher
          activeProfile={activeProfile}
          onSwitch={(name) => {
            handleSelectProfile(name);
            goTo("chat");
          }}
          onManage={() => goTo("workspaces")}
          onResumeSession={handleResumeSession}
        />

        {/* Navegação por modo */}
        <nav className="sidebar-nav">
          {navGroups.map((group, gi) => (
            <div key={gi} className="sidebar-nav-group">
              <div className="sidebar-nav-group-label">{group.label}</div>
              {group.items.map(({ view: v, icon: Icon, label }) => (
                <button
                  key={v}
                  className={`sidebar-nav-item ${view === v ? "active" : ""}`}
                  onClick={() => goTo(v)}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          {updateState && (
            <button
              className={`sidebar-update-btn ${updateState === "error" ? "error" : ""}`}
              onClick={handleUpdate}
              disabled={updateState === "downloading"}
              title={updateError ?? undefined}
            >
              <Download size={13} />
              {updateState === "available" && (
                <span>{t("common.updateAvailable", { version: updateVersion })}</span>
              )}
              {updateState === "downloading" && (
                <span>{t("common.downloading", { percent: downloadPercent })}</span>
              )}
              {updateState === "ready" && <span>{t("common.restartToUpdate")}</span>}
              {updateState === "error" && <span>{t("common.updateFailed")}</span>}
            </button>
          )}
          <div className="sidebar-footer-text">{t("common.appName")}</div>
        </div>
      </aside>

      <main className="content">
        {verifyWarning && onReinstall && onDismissVerifyWarning && (
          <VerifyWarningBanner
            onReinstall={onReinstall}
            onDismiss={onDismissVerifyWarning}
          />
        )}

        <div style={paneStyle("chat")}>
          <Chat
            messages={messages}
            setMessages={setMessages}
            sessionId={currentSessionId}
            profile={activeProfile}
            onNewChat={handleNewChat}
          />
        </div>

        {visitedViews.has("code-dashboard") && (
          <div style={paneStyle("code-dashboard")}>
            <CodeDashboard />
          </div>
        )}

        {visitedViews.has("sessions") && (
          <div style={paneStyle("sessions")}>
            {remoteMode ? (
              <RemoteNotice feature="Sessions" />
            ) : (
              <Sessions
                onResumeSession={handleResumeSession}
                onNewChat={handleNewChat}
                currentSessionId={currentSessionId}
                visible={view === "sessions"}
              />
            )}
          </div>
        )}

        {visitedViews.has("agents") && (
          <div style={paneStyle("agents")}>
            {remoteMode ? (
              <RemoteNotice feature="Profiles" />
            ) : (
              <Agents
                activeProfile={activeProfile}
                onSelectProfile={handleSelectProfile}
                onChatWith={(name: string) => {
                  handleSelectProfile(name);
                  goTo("chat");
                }}
              />
            )}
          </div>
        )}

        {visitedViews.has("office") && (
          <div style={paneStyle("office")}>
            <Office profile={activeProfile} visible={view === "office"} />
          </div>
        )}

        {visitedViews.has("models") && (
          <div style={paneStyle("models")}>
            <Models visible={view === "models"} />
          </div>
        )}

        {visitedViews.has("providers") && (
          <div style={paneStyle("providers")}>
            {remoteMode ? (
              <RemoteNotice feature="Providers" />
            ) : (
              <Providers profile={activeProfile} visible={view === "providers"} />
            )}
          </div>
        )}

        {visitedViews.has("skills") && (
          <div style={paneStyle("skills")}>
            {remoteMode ? (
              <RemoteNotice feature="Skills" />
            ) : (
              <Skills profile={activeProfile} />
            )}
          </div>
        )}

        {visitedViews.has("soul") && (
          <div style={paneStyle("soul")}>
            {remoteMode ? (
              <RemoteNotice feature="Persona" />
            ) : (
              <Soul profile={activeProfile} />
            )}
          </div>
        )}

        {visitedViews.has("memory") && (
          <div style={paneStyle("memory")}>
            {remoteMode ? (
              <RemoteNotice feature="Memory" />
            ) : (
              <Memory profile={activeProfile} />
            )}
          </div>
        )}

        {visitedViews.has("tools") && (
          <div style={paneStyle("tools")}>
            {remoteMode ? (
              <RemoteNotice feature="Tools" />
            ) : (
              <Tools profile={activeProfile} />
            )}
          </div>
        )}

        {visitedViews.has("schedules") && (
          <div style={paneStyle("schedules")}>
            <Schedules profile={activeProfile} />
          </div>
        )}

        {visitedViews.has("kanban") && (
          <div style={paneStyle("kanban")}>
            {remoteMode ? (
              <RemoteNotice feature="Kanban" />
            ) : (
              <Kanban profile={activeProfile} visible={view === "kanban"} />
            )}
          </div>
        )}

        {visitedViews.has("gateway") && (
          <div style={paneStyle("gateway")}>
            {remoteMode ? (
              <RemoteNotice feature="Gateway" />
            ) : (
              <Gateway profile={activeProfile} />
            )}
          </div>
        )}

        {visitedViews.has("settings") && (
          <div style={paneStyle("settings")}>
            <Settings profile={activeProfile} />
          </div>
        )}

        {visitedViews.has("workspaces") && (
          <div style={paneStyle("workspaces")}>
            {remoteMode ? (
              <RemoteNotice feature="Workspaces" />
            ) : (
              <Workspaces
                activeProfile={activeProfile}
                onSelectWorkspace={(name) => {
                  handleSelectProfile(name);
                  goTo("chat");
                }}
                onClearMessages={() => setMessages([])}
                onClearSession={() => setCurrentSessionId(null)}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default Layout;
