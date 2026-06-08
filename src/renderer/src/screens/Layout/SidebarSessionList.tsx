import { useState, useEffect, useCallback } from "react";
import { MessageSquare, Trash2 } from "lucide-react";

interface Session {
  id: string;
  title: string | null;
  preview: string;
  startedAt: number;
}

interface SidebarSessionListProps {
  currentSessionId: string | null;
  refreshKey?: number;
  onResumeSession: (sessionId: string) => void;
}

function getGroupLabel(ts: number): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const last7 = today - 7 * 86400000;
  const last30 = today - 30 * 86400000;

  if (ts >= today) return "Hoje";
  if (ts >= yesterday) return "Ontem";
  if (ts >= last7) return "Últimos 7 dias";
  if (ts >= last30) return "Últimos 30 dias";

  const d = new Date(ts);
  const name = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function groupSessions(sessions: Session[]): Array<{ label: string; items: Session[] }> {
  const groups = new Map<string, Session[]>();
  for (const s of sessions) {
    const key = getGroupLabel(s.startedAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

export function SidebarSessionList({
  currentSessionId,
  refreshKey,
  onResumeSession,
}: SidebarSessionListProps): React.JSX.Element {
  const [sessions, setSessions] = useState<Session[]>([]);

  const loadSessions = useCallback(async () => {
    try {
      const data = await window.hermesAPI.listSessions(100);
      setSessions(
        data.map((s) => ({
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
    void loadSessions();
  }, [loadSessions, refreshKey]);

  useEffect(() => {
    const id = setInterval(() => void loadSessions(), 5000);
    return () => clearInterval(id);
  }, [loadSessions]);

  const handleDelete = useCallback(
    async (e: React.MouseEvent, sessionId: string) => {
      e.stopPropagation();
      try {
        await window.hermesAPI.deleteSession(sessionId);
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      } catch {
        // silently ignore
      }
    },
    [],
  );

  const groups = groupSessions(sessions);

  if (groups.length === 0) {
    return (
      <div className="sidebar-session-list sidebar-session-list--empty">
        <span className="sidebar-session-empty">Nenhuma conversa</span>
      </div>
    );
  }

  return (
    <div className="sidebar-session-list">
      {groups.map((group) => (
        <div key={group.label} className="sidebar-session-group">
          <div className="sidebar-session-group-label">{group.label}</div>
          {group.items.map((s) => (
            <div key={s.id} className="sidebar-session-item">
              <button
                className={`sidebar-session-btn${s.id === currentSessionId ? " active" : ""}`}
                onClick={() => onResumeSession(s.id)}
                title={s.title ?? s.preview}
              >
                <MessageSquare size={12} className="sidebar-session-icon" />
                <span className="sidebar-session-title">
                  {(s.title ?? s.preview?.slice(0, 40)) || "Nova conversa"}
                </span>
              </button>
              <button
                className="sidebar-session-delete"
                onClick={(e) => void handleDelete(e, s.id)}
                title="Deletar"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
