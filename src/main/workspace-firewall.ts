export type ResourceType =
  | "session"
  | "memory"
  | "skill"
  | "cron"
  | "soul"
  | "tool"
  | "config"
  | "embedding";

export type Permission = "read" | "write" | "delete";

export interface FirewallResult {
  allowed: boolean;
  reason?: string;
}

/**
 * WorkspaceContextFirewall — middleware de isolamento por workspace.
 * Recursos globais (workspace_id = undefined/null) sempre são permitidos.
 */
export class WorkspaceContextFirewall {
  private readonly activeWorkspace: string;

  constructor(activeWorkspace: string) {
    this.activeWorkspace = activeWorkspace;
  }

  canAccess(resourceWorkspace: string | undefined | null): boolean {
    if (resourceWorkspace == null) return true;
    return resourceWorkspace === this.activeWorkspace;
  }

  validate(
    resourceWorkspace: string | undefined | null,
    resourceType: ResourceType,
    permission: Permission,
  ): FirewallResult {
    if (this.canAccess(resourceWorkspace)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Acesso bloqueado: ${resourceType} pertence ao workspace '${resourceWorkspace}', workspace ativo é '${this.activeWorkspace}'. Operação: ${permission}.`,
    };
  }

  assertAccess(
    resourceWorkspace: string | undefined | null,
    resourceType: ResourceType,
    permission: Permission,
  ): void {
    const result = this.validate(resourceWorkspace, resourceType, permission);
    if (!result.allowed) {
      throw new Error(`[WorkspaceFirewall] ${result.reason}`);
    }
  }
}

let _activeFirewall: WorkspaceContextFirewall = new WorkspaceContextFirewall("default");

export function getFirewall(): WorkspaceContextFirewall {
  return _activeFirewall;
}

export function setActiveWorkspace(workspace: string): void {
  _activeFirewall = new WorkspaceContextFirewall(workspace);
}
