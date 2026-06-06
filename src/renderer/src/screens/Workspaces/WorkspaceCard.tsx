import { useState } from "react";
import {
  Archive,
  Copy,
  Trash2,
  MoreHorizontal,
  FolderOpen,
  Zap,
  Home,
  Building2,
  Rocket,
  Briefcase,
  FlaskConical,
  Palette,
  Settings2,
  BarChart3,
  HardHat,
  Globe,
  Bot,
  TestTube2,
  Code2,
  Database,
  Layers,
  BookOpen,
  Cpu,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const WORKSPACE_ICON_MAP: Record<string, LucideIcon> = {
  folder: FolderOpen,
  home: Home,
  building: Building2,
  rocket: Rocket,
  briefcase: Briefcase,
  flask: FlaskConical,
  palette: Palette,
  settings: Settings2,
  chart: BarChart3,
  construction: HardHat,
  globe: Globe,
  bot: Bot,
  beaker: TestTube2,
  code: Code2,
  database: Database,
  layers: Layers,
  book: BookOpen,
  cpu: Cpu,
  zap: Zap,
};

export const WORKSPACE_ICON_NAMES = Object.keys(WORKSPACE_ICON_MAP);

export function WorkspaceIconRenderer({
  name,
  size = 16,
}: {
  name: string;
  size?: number;
}): React.JSX.Element {
  const Icon = WORKSPACE_ICON_MAP[name] ?? WORKSPACE_ICON_MAP.folder;
  return <Icon size={size} />;
}

export interface WorkspaceCardData {
  profileName: string;
  displayName: string;
  description: string;
  icon: string;
  color: string;
  isActive: boolean;
  isDefault: boolean;
  sessionCount?: number;
  skillCount?: number;
  archivedAt: number | null;
  workingDirectory?: string | null;
}

interface WorkspaceCardProps {
  workspace: WorkspaceCardData;
  onSelect: (profileName: string) => void;
  onDuplicate: (profileName: string) => void;
  onArchive: (profileName: string) => void;
  onDelete: (profileName: string) => void;
  onSetFolder: (profileName: string) => void;
}

function abbrevPath(p: string): string {
  const homeMatch = p.match(/^\/Users\/[^/]+\/(.*)$/);
  if (homeMatch) return `~/${homeMatch[1]}`;
  const parts = p.split("/");
  if (parts.length > 4) return `…/${parts.slice(-3).join("/")}`;
  return p;
}

export function WorkspaceCard({
  workspace,
  onSelect,
  onDuplicate,
  onArchive,
  onDelete,
  onSetFolder,
}: WorkspaceCardProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = (): void => setMenuOpen(false);

  return (
    <div
      className={`workspace-card${workspace.isActive ? " workspace-card-active" : ""}${workspace.archivedAt ? " workspace-card-archived" : ""}`}
      style={
        {
          "--ws-color": workspace.color,
          borderTopColor: workspace.isActive ? workspace.color : undefined,
        } as React.CSSProperties
      }
    >
      {/* Clickable main area */}
      <div
        className="workspace-card-body"
        onClick={() => onSelect(workspace.profileName)}
      >
        <div className="workspace-card-header">
          <span
            className="workspace-card-icon"
            style={{
              color: workspace.color,
              background: `${workspace.color}1a`,
            }}
          >
            <WorkspaceIconRenderer name={workspace.icon} size={18} />
          </span>
          <div className="workspace-card-info">
            <div className="workspace-card-name">
              <span>{workspace.displayName}</span>
              {workspace.isActive && (
                <span
                  className="workspace-card-active-badge"
                  style={{ background: workspace.color }}
                >
                  Ativo
                </span>
              )}
              {workspace.archivedAt && (
                <span className="workspace-card-archived-badge">Arquivado</span>
              )}
            </div>
            {workspace.description && (
              <div className="workspace-card-description">
                {workspace.description}
              </div>
            )}
          </div>
        </div>

        <div className="workspace-card-footer">
          {workspace.workingDirectory ? (
            <div
              className="workspace-card-folder"
              title={workspace.workingDirectory}
            >
              <FolderOpen size={10} />
              <span>{abbrevPath(workspace.workingDirectory)}</span>
            </div>
          ) : (
            <div className="workspace-card-stats">
              {workspace.skillCount != null && workspace.skillCount > 0 && (
                <>
                  <Zap size={10} />
                  <span>{workspace.skillCount} skills</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Context menu */}
      <div className="workspace-card-actions">
        <button
          className="workspace-menu-btn"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          title="Opções"
          aria-label="Opções do workspace"
        >
          <MoreHorizontal size={14} />
        </button>

        {menuOpen && (
          <div
            className="workspace-dropdown"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { onSetFolder(workspace.profileName); closeMenu(); }}
            >
              <FolderOpen size={12} /> Definir pasta
            </button>
            {!workspace.isDefault && (
              <button
                onClick={() => { onDuplicate(workspace.profileName); closeMenu(); }}
              >
                <Copy size={12} /> Duplicar
              </button>
            )}
            {!workspace.archivedAt && !workspace.isDefault && (
              <button
                onClick={() => { onArchive(workspace.profileName); closeMenu(); }}
              >
                <Archive size={12} /> Arquivar
              </button>
            )}
            {!workspace.isDefault && (
              <>
                <div className="workspace-dropdown-separator" />
                <button
                  className="workspace-dropdown-danger"
                  onClick={() => { onDelete(workspace.profileName); closeMenu(); }}
                >
                  <Trash2 size={12} /> Excluir
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
