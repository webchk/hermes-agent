import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, Plus, Settings2, Check, MessageSquare } from "lucide-react";
import { WorkspaceIconRenderer } from "../Workspaces/WorkspaceCard";

interface WorkspaceEntry {
  profileName: string;
  displayName: string;
  icon: string;
  color: string;
  archivedAt: number | null;
}

interface RecentSession {
  id: string;
  title: string | null;
  preview: string;
  startedAt: number;
}

interface WorkspaceSwitcherProps {
  activeProfile: string;
  onSwitch: (profileName: string) => void;
  onManage: () => void;
  onResumeSession?: (sessionId: string) => void;
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "agora";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function WorkspaceSwitcher({
  activeProfile,
  onSwitch,
  onManage,
  onResumeSession,
}: WorkspaceSwitcherProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([]);
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const profiles = await window.hermesAPI.listProfiles();
      const entries = await Promise.all(
        profiles.map(async (p) => {
          const meta = await window.hermesAPI.readWorkspaceMeta(
            p.isDefault ? undefined : p.name,
          );
          return {
            profileName: p.isDefault ? "default" : p.name,
            displayName: meta.displayName,
            icon: meta.icon,
            color: meta.color,
            archivedAt: meta.archivedAt,
          };
        }),
      );
      setWorkspaces(entries.filter((e) => !e.archivedAt));
    } catch {
      // silently ignore
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const sessions = await window.hermesAPI.listSessions(5);
      setRecentSessions(
        sessions.map((s) => ({
          id: s.id,
          title: s.title,
          preview: s.preview,
          startedAt: s.startedAt,
        })),
      );
    } catch {
      // silently ignore
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    load();
    loadSessions();
  }, [activeProfile, load, loadSessions]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const current =
    workspaces.find((w) => w.profileName === activeProfile) ?? workspaces[0];
  const others = workspaces.filter((w) => w.profileName !== activeProfile);

  return (
    <div className="ws-switcher-wrap" ref={wrapRef}>
      {/* Trigger */}
      <button
        className={`ws-switcher-btn${open ? " open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title="Trocar workspace"
      >
        {current ? (
          <span
            className="ws-switcher-icon"
            style={{ color: current.color, background: `${current.color}22` }}
          >
            <WorkspaceIconRenderer name={current.icon} size={13} />
          </span>
        ) : (
          <span className="ws-switcher-icon ws-switcher-icon--placeholder" />
        )}
        <span className="ws-switcher-name">
          {current?.displayName ?? activeProfile}
        </span>
        <ChevronDown
          size={11}
          className={`ws-switcher-chevron${open ? " open" : ""}`}
        />
      </button>

      {/* Recent sessions — always visible when available */}
      {recentSessions.length > 0 && onResumeSession && (
        <div className="ws-recent-sessions">
          {recentSessions.map((s) => (
            <button
              key={s.id}
              className="ws-session-item"
              onClick={() => onResumeSession(s.id)}
              title={s.title ?? s.preview}
            >
              <MessageSquare size={11} className="ws-session-icon" />
              <span className="ws-session-title">
                {(s.title ?? s.preview?.slice(0, 42)) || "Nova conversa"}
              </span>
              <span className="ws-session-time">{timeAgo(s.startedAt)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Picker dropdown */}
      {open && (
        <div className="ws-picker">
          <div className="ws-picker-section-label">Workspace atual</div>
          {current && (
            <div className="ws-picker-item ws-picker-item--current">
              <span
                className="ws-picker-icon"
                style={{ color: current.color, background: `${current.color}22` }}
              >
                <WorkspaceIconRenderer name={current.icon} size={13} />
              </span>
              <span className="ws-picker-label">{current.displayName}</span>
              <Check size={12} className="ws-picker-check" />
            </div>
          )}

          {others.length > 0 && (
            <>
              <div className="ws-picker-divider" />
              <div className="ws-picker-section-label">Trocar para</div>
              {others.map((ws) => (
                <button
                  key={ws.profileName}
                  className="ws-picker-item ws-picker-item--btn"
                  onClick={() => {
                    onSwitch(ws.profileName);
                    setOpen(false);
                  }}
                >
                  <span
                    className="ws-picker-icon"
                    style={{ color: ws.color, background: `${ws.color}22` }}
                  >
                    <WorkspaceIconRenderer name={ws.icon} size={13} />
                  </span>
                  <span className="ws-picker-label">{ws.displayName}</span>
                </button>
              ))}
            </>
          )}

          <div className="ws-picker-divider" />
          <div className="ws-picker-footer">
            <button
              className="ws-picker-action"
              onClick={() => { onManage(); setOpen(false); }}
            >
              <Settings2 size={12} />
              <span>Gerenciar workspaces</span>
            </button>
            <button
              className="ws-picker-action"
              onClick={() => { onManage(); setOpen(false); }}
            >
              <Plus size={12} />
              <span>Novo workspace</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
