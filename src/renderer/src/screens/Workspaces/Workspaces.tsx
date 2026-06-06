import { useState, useEffect, useCallback } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { WorkspaceCard, type WorkspaceCardData } from "./WorkspaceCard";
import { WorkspaceCreateModal } from "./WorkspaceCreateModal";
import { useWorkspaceSwitch } from "../../hooks/useWorkspaceSwitch";

interface WorkspacesProps {
  activeProfile: string;
  onSelectWorkspace: (profileName: string) => void;
  onClearMessages: () => void;
  onClearSession: () => void;
}

export default function Workspaces({
  activeProfile,
  onSelectWorkspace,
  onClearMessages,
  onClearSession,
}: WorkspacesProps): React.JSX.Element {
  const [workspaces, setWorkspaces] = useState<WorkspaceCardData[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { switchWorkspace } = useWorkspaceSwitch({
    onClearMessages,
    onClearSession,
    onProfileChanged: onSelectWorkspace,
  });

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profiles = await window.hermesAPI.listProfiles();
      const cards: WorkspaceCardData[] = await Promise.all(
        profiles.map(async (p) => {
          const meta = await window.hermesAPI.readWorkspaceMeta(
            p.isDefault ? undefined : p.name,
          );
          return {
            profileName: p.isDefault ? "default" : p.name,
            displayName: meta.displayName,
            description: meta.description,
            icon: meta.icon,
            color: meta.color,
            isActive: p.isActive,
            isDefault: p.isDefault,
            skillCount: p.skillCount,
            archivedAt: meta.archivedAt,
            workingDirectory: meta.workingDirectory ?? null,
          };
        }),
      );
      setWorkspaces(cards);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  void activeProfile;

  async function handleSelect(profileName: string): Promise<void> {
    await switchWorkspace(profileName);
  }

  async function handleCreate(
    name: string,
    displayName: string,
    icon: string,
    color: string,
    clone: boolean,
    workingDirectory?: string | null,
  ): Promise<void> {
    const result = await window.hermesAPI.createProfile(name, clone);
    if (!result.success) {
      setError(result.error ?? "Falha ao criar workspace");
      return;
    }
    await window.hermesAPI.writeWorkspaceMeta(
      {
        displayName,
        description: "",
        icon,
        color,
        createdAt: Date.now(),
        archivedAt: null,
        workingDirectory: workingDirectory ?? null,
      },
      name,
    );
    setShowCreate(false);
    loadWorkspaces();
  }

  async function handleArchive(profileName: string): Promise<void> {
    await window.hermesAPI.updateWorkspaceMeta(
      { archivedAt: Date.now() },
      profileName === "default" ? undefined : profileName,
    );
    loadWorkspaces();
  }

  async function handleDeleteConfirmed(profileName: string): Promise<void> {
    setConfirmDelete(null);
    const result = await window.hermesAPI.deleteProfile(profileName);
    if (!result.success) {
      setError(result.error ?? "Falha ao excluir");
      return;
    }
    loadWorkspaces();
  }

  function handleDelete(profileName: string): void {
    setConfirmDelete(profileName);
  }

  async function handleDuplicate(profileName: string): Promise<void> {
    const newName = `${profileName}_copy_${Date.now().toString(36)}`;
    const result = await window.hermesAPI.createProfile(newName, true);
    if (!result.success) {
      setError(result.error ?? "Falha ao duplicar");
      return;
    }
    loadWorkspaces();
  }

  async function handleSetFolder(profileName: string): Promise<void> {
    const path = await window.hermesAPI.selectFolder();
    if (!path) return;
    await window.hermesAPI.updateWorkspaceMeta(
      { workingDirectory: path },
      profileName === "default" ? undefined : profileName,
    );
    loadWorkspaces();
  }

  const active = workspaces.filter((w) => !w.archivedAt);
  const archived = workspaces.filter((w) => !!w.archivedAt);

  return (
    <div className="workspaces-screen">
      <div className="workspaces-header">
        <div>
          <h1>Workspaces</h1>
          <p className="workspaces-subtitle">
            Ambientes isolados — memória, sessões e skills independentes por workspace.
          </p>
        </div>
        <div className="workspaces-header-actions">
          <button className="icon-btn" onClick={loadWorkspaces} title="Recarregar">
            <RefreshCw size={14} />
          </button>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> Novo Workspace
          </button>
        </div>
      </div>

      {error && (
        <div className="workspaces-error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {confirmDelete && (
        <div className="workspaces-confirm">
          <span>
            Excluir <strong>{confirmDelete}</strong>? Esta ação não pode ser desfeita.
          </span>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button
              className="btn-danger"
              onClick={() => handleDeleteConfirmed(confirmDelete)}
            >
              Excluir
            </button>
            <button className="btn-secondary" onClick={() => setConfirmDelete(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="workspaces-loading">Carregando workspaces…</div>
      ) : (
        <>
          {active.length > 0 && (
            <>
              <div className="workspaces-section-label">Ativos ({active.length})</div>
              <div className="workspaces-grid">
                {active.map((ws) => (
                  <WorkspaceCard
                    key={ws.profileName}
                    workspace={ws}
                    onSelect={handleSelect}
                    onDuplicate={handleDuplicate}
                    onArchive={handleArchive}
                    onDelete={handleDelete}
                    onSetFolder={handleSetFolder}
                  />
                ))}
              </div>
            </>
          )}

          {archived.length > 0 && (
            <div className="workspaces-archived-section">
              <div className="workspaces-section-label">Arquivados ({archived.length})</div>
              <div className="workspaces-grid">
                {archived.map((ws) => (
                  <WorkspaceCard
                    key={ws.profileName}
                    workspace={ws}
                    onSelect={handleSelect}
                    onDuplicate={handleDuplicate}
                    onArchive={handleArchive}
                    onDelete={handleDelete}
                    onSetFolder={handleSetFolder}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {showCreate && (
        <WorkspaceCreateModal
          onConfirm={handleCreate}
          onCancel={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
