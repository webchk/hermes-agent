import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { profileHome } from "./utils";

const WORKSPACE_META_FILE = "workspace.json";

export interface WorkspaceMeta {
  displayName: string;
  description: string;
  icon: string;
  color: string;
  createdAt: number;
  archivedAt: number | null;
  workingDirectory?: string | null;
}

export function parseWorkspaceMeta(raw: string): WorkspaceMeta | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceMeta>;
    if (!parsed.displayName) return null;
    return {
      displayName: parsed.displayName,
      description: parsed.description ?? "",
      icon: parsed.icon ?? "folder",
      color: parsed.color ?? "#6b7280",
      createdAt: parsed.createdAt ?? 0,
      archivedAt: parsed.archivedAt ?? null,
      workingDirectory: parsed.workingDirectory ?? null,
    };
  } catch {
    return null;
  }
}

export function serializeWorkspaceMeta(meta: WorkspaceMeta): string {
  return JSON.stringify(meta, null, 2);
}

function workspaceMetaPath(profile?: string): string {
  return join(profileHome(profile), WORKSPACE_META_FILE);
}

export function readWorkspaceMeta(profile?: string): WorkspaceMeta {
  const metaPath = workspaceMetaPath(profile);
  if (existsSync(metaPath)) {
    try {
      const raw = readFileSync(metaPath, "utf-8");
      const parsed = parseWorkspaceMeta(raw);
      if (parsed) return parsed;
    } catch { /* fall through */ }
  }
  const displayName = !profile || profile === "default" ? "Workspace Padrão" : profile;
  return {
    displayName,
    description: "",
    icon: profile === "default" || !profile ? "home" : "folder",
    color: "#6b7280",
    createdAt: Date.now(),
    archivedAt: null,
  };
}

export function writeWorkspaceMeta(
  meta: WorkspaceMeta,
  profile?: string,
): { success: boolean; error?: string } {
  try {
    const metaPath = workspaceMetaPath(profile);
    writeFileSync(metaPath, serializeWorkspaceMeta(meta), "utf-8");
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export function updateWorkspaceMeta(
  updates: Partial<WorkspaceMeta>,
  profile?: string,
): { success: boolean; error?: string } {
  const current = readWorkspaceMeta(profile);
  return writeWorkspaceMeta({ ...current, ...updates }, profile);
}
