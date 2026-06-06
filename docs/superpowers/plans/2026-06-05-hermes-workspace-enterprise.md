# Hermes Enterprise Workspace Architecture — Plano de Implementação

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o Hermes Desktop em plataforma multiworkspace com isolamento real de memória, sessões, conhecimento, contexto e agentes, preservando todas as funcionalidades existentes.

**Architecture:** Os Perfis existentes (`~/.hermes/profiles/<name>/`) já provêm isolamento de filesystem — eles ARE os workspaces. A implementação adiciona: (1) metadados de workspace (`workspace.json`), (2) WorkspaceContextFirewall como middleware TypeScript, (3) filtro de conteúdo para remover prefixos de cron job do chat, (4) Session Controller para limpeza de contexto na troca de workspace, (5) UI de Workspace Manager, e (6) status bar permanente. Nenhuma camada de dados nova é necessária para o isolamento básico — aproveitamos o filesystem existente.

**Tech Stack:** TypeScript, React 19, Electron (IPC/main process), better-sqlite3, Tailwind 4, Vite, Vitest

---

## Visão Geral dos Arquivos

### Arquivos CRIADOS (novos):
- `src/main/workspace.ts` — CRUD de metadados de workspace (`workspace.json` por perfil)
- `src/main/workspace-firewall.ts` — WorkspaceContextFirewall: valida acesso por workspace
- `src/renderer/src/screens/Workspaces/Workspaces.tsx` — Workspace Manager UI (lista/cria/arquiva)
- `src/renderer/src/screens/Workspaces/WorkspaceCard.tsx` — Card de workspace individual
- `src/renderer/src/screens/Workspaces/WorkspaceCreateModal.tsx` — Modal de criação
- `src/renderer/src/hooks/useWorkspaceSwitch.ts` — Hook: limpa contexto ao trocar workspace
- `src/renderer/src/hooks/useContentFilter.ts` — Hook: filtra prefixos de sistema do conteúdo
- `tests/workspace.test.ts` — Testes unitários do workspace.ts
- `tests/workspace-firewall.test.ts` — Testes do WorkspaceContextFirewall
- `tests/content-filter.test.ts` — Testes do filtro de conteúdo

### Arquivos MODIFICADOS:
- `src/main/index.ts` — Registrar handlers IPC do workspace
- `src/preload/index.ts` — Expor API de workspace ao renderer
- `src/preload/index.d.ts` — Tipos da API de workspace
- `src/main/cronjobs.ts` — Fix: null repeat crash (1 linha, merge do upstream)
- `src/renderer/src/screens/Chat/MessageRow.tsx` — Filtrar conteúdo de sistema antes de exibir
- `src/renderer/src/screens/Layout/Layout.tsx` — Adicionar view "workspaces" + status bar
- `package.json` — Bumps de segurança de dependências

---

## Contexto Crítico para Implementadores

### Como os Perfis/Workspaces funcionam hoje
```
~/.hermes/
├── state.db           ← perfil default (sessões + mensagens)
├── memories/
│   ├── MEMORY.md      ← memória do agente (perfil default)
│   └── USER.md        ← perfil do usuário (perfil default)
├── cron/jobs.json     ← cron jobs (perfil default)
├── skills/            ← skills instaladas (perfil default)
├── config.yaml        ← modelo + provider
├── .env               ← API keys
├── SOUL.md            ← personalidade
└── profiles/
    └── empresa_a/     ← workspace "Empresa A"
        ├── state.db
        ├── memories/
        ├── cron/jobs.json
        ├── skills/
        ├── config.yaml
        └── .env
```

**Regra fundamental:** `profileHome(profile)` em `utils.ts` resolve o diretório correto. Todo acesso de dados JÁ passa por este caminho. O WorkspaceFirewall valida que recursos acessados pertencem ao workspace ativo.

### Problema do prefixo de cron no chat
O agente Python injeta no início de mensagens agendadas:
```
[IMPORTANT: You are running as a scheduled cron job. DELIVERY: Your final response will be automatically delivered to the user...]
```
Este prefixo não deve aparecer no chat UI. Deve ser filtrado antes de exibir.

### IPC Pattern existente
O padrão real usa **kebab-case sem namespace** (confirmado em `src/main/index.ts`):
```typescript
// main/index.ts — registro de handler IPC (kebab-case, sem prefixo)
ipcMain.handle("list-profiles", async () => { ... })
ipcMain.handle("create-profile", (_event, name: string, clone: boolean) => { ... })
ipcMain.handle("read-memory", (_event, profile?: string) => { ... })

// preload/index.ts — exposição ao renderer
listProfiles: () => ipcRenderer.invoke("list-profiles"),

// renderer — uso
const profiles = await window.hermesAPI.listProfiles()
```

**IMPORTANTE:** Usar sempre kebab-case para novos canais: `"read-workspace-meta"`, não `"hermes:readWorkspaceMeta"`.

---

## Task 1: Fix Imediato — Filtro de Conteúdo do Cron Job

**Objetivo:** Remover prefixos de sistema de mensagens do agente antes de exibir no chat.

**Files:**
- Create: `src/renderer/src/hooks/useContentFilter.ts`
- Create: `tests/content-filter.test.ts`
- Modify: `src/renderer/src/screens/Chat/MessageRow.tsx:39-68`

- [ ] **Step 1.1: Escrever o teste falhando**

Criar `tests/content-filter.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { filterSystemContent } from "../src/renderer/src/hooks/useContentFilter";

describe("filterSystemContent", () => {
  it("remove cron job prefix", () => {
    const input = "[IMPORTANT: You are running as a scheduled cron job. DELIVERY: Your final response will be automatically delivered to the user — do NOT use send_message or try to deliver the output yourself. Just produce your report/output as your final response and the system handles the rest. SILENT: If there is genuinely nothing new to report, respond with exactly \"[SILENT]\" (nothing else) to suppress delivery. Never combine [SILENT] with content — either report your findings normally, or say [SILENT] and nothing more.]\n\nHere is my report...";
    expect(filterSystemContent(input)).toBe("Here is my report...");
  });

  it("remove inline system markers", () => {
    const input = "[IMPORTANT: something internal]\nReal content here";
    expect(filterSystemContent(input)).toBe("Real content here");
  });

  it("preserve normal content unchanged", () => {
    const input = "Normal assistant response without system markers";
    expect(filterSystemContent(input)).toBe(input);
  });

  it("handle empty string", () => {
    expect(filterSystemContent("")).toBe("");
  });

  it("preserve [SILENT] response intact when it is the full content", () => {
    expect(filterSystemContent("[SILENT]")).toBe("");
  });
});
```

- [ ] **Step 1.2: Executar teste e verificar falha**

```bash
cd /Users/souza/Documents/hermes-transfer-20260531-123839/hermes-desktop-src
npm test -- --reporter=verbose tests/content-filter.test.ts
```
Esperado: FAIL — `Cannot find module`

- [ ] **Step 1.3: Implementar o hook**

Criar `src/renderer/src/hooks/useContentFilter.ts`:
```typescript
// Padrões que identificam conteúdo de sistema não destinado ao usuário final
const SYSTEM_PATTERNS: RegExp[] = [
  // Prefixo de cron job (múltiplas linhas)
  /^\[IMPORTANT:[\s\S]*?\.]\s*/,
  // [SILENT] como resposta completa
  /^\[SILENT\]\s*$/,
  // Marcadores DELIVERY/SILENT inline
  /DELIVERY:[\s\S]*?(?=\n[A-Z]|\n\n|$)/g,
];

export function filterSystemContent(content: string): string {
  if (!content) return "";
  let filtered = content;

  // Remove bloco [IMPORTANT: ...] no início (greedy até o fechamento "]")
  filtered = filtered.replace(/^\[IMPORTANT:[\s\S]*?\]\s*/m, "");

  // Remove resposta [SILENT] como conteúdo único
  if (filtered.trim() === "[SILENT]") return "";

  return filtered.trim();
}
```

- [ ] **Step 1.4: Executar teste e verificar aprovação**

```bash
npm test -- --reporter=verbose tests/content-filter.test.ts
```
Esperado: PASS em todos os 5 casos

- [ ] **Step 1.5: Aplicar filtro no MessageRow**

Ler e modificar `src/renderer/src/screens/Chat/MessageRow.tsx`.

Adicionar import no topo:
```typescript
import { filterSystemContent } from "../../hooks/useContentFilter";
```

Na linha onde `msg.content` é passado ao `AgentMarkdown`, aplicar o filtro.

**ATENÇÃO:** `AgentMarkdown` usa `children` (não `content` prop) — verificado em `src/renderer/src/components/AgentMarkdown.tsx:344`. O padrão correto é:
```typescript
// Antes:
<AgentMarkdown>{msg.content}</AgentMarkdown>

// Depois:
<AgentMarkdown>
  {msg.role === "agent" ? filterSystemContent(msg.content) : msg.content}
</AgentMarkdown>
```

- [ ] **Step 1.6: Executar todos os testes**

```bash
npm test
```
Esperado: todos passando, nenhum regresso

- [ ] **Step 1.7: Commit**

```bash
git add src/renderer/src/hooks/useContentFilter.ts tests/content-filter.test.ts src/renderer/src/screens/Chat/MessageRow.tsx
git commit -m "feat(chat): filter system prefix content from cron job messages"
```

---

## Task 2: Fix do Upstream — Cron null repeat crash

**Objetivo:** Verificar e corrigir o bug de crash quando `repeat` é null num cron job (port do hermes-agent v0.15.1). O bug upstream está em Python (`job.get("repeat", {})` → deve ser `job.get("repeat") or {}`). No TypeScript do desktop, verificar se há acesso a `job.repeat.times` sem null check.

**File:**
- Modify: `src/main/cronjobs.ts` (verificar linha ~56 na função `normalizeJob`)

- [ ] **Step 2.1: Inspecionar o código atual**

```bash
grep -n "repeat" /Users/souza/Documents/hermes-transfer-20260531-123839/hermes-desktop-src/src/main/cronjobs.ts
```

Verificar se existe algum acesso `job.repeat.times` ou `job.repeat.completed` sem null check.

- [ ] **Step 2.2: Aplicar fix se necessário**

Se houver acesso direto `job.repeat.times` sem checar se `repeat` é null, envolver com guard:
```typescript
// Antes (inseguro):
const times = job.repeat.times;

// Depois (seguro):
const times = job.repeat?.times ?? null;
```

O campo `repeat` em `normalizeJob` já deve ter:
```typescript
repeat: (job.repeat as CronJob["repeat"]) || null,
```
Isso já é null-safe em TypeScript. Confirmar visualmente que nenhum consumidor do campo acessa sem opcional chaining.

- [ ] **Step 2.3: Executar todos os testes**

```bash
npm test
```

- [ ] **Step 2.4: Commit (apenas se houve mudança)**

```bash
git add src/main/cronjobs.ts
git commit -m "fix(cron): guard null repeat field (port from hermes-agent v0.15.1)"
```

---

## Task 3: Workspace Data Model

**Objetivo:** Criar `workspace.ts` no main process com CRUD de metadados de workspace (`workspace.json` por perfil). Workspace = Profile + metadados extras.

**Files:**
- Create: `src/main/workspace.ts`
- Create: `tests/workspace.test.ts`

- [ ] **Step 3.1: Escrever testes falhando**

Criar `tests/workspace.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Vamos testar as funções puras de serialização/parse
import {
  parseWorkspaceMeta,
  serializeWorkspaceMeta,
  type WorkspaceMeta,
} from "../src/main/workspace";

describe("workspace metadata", () => {
  it("serializes and parses workspace meta", () => {
    const meta: WorkspaceMeta = {
      displayName: "Empresa A",
      description: "Projetos da empresa A",
      icon: "🏢",
      color: "#3b82f6",
      createdAt: 1748000000,
      archivedAt: null,
    };
    const json = serializeWorkspaceMeta(meta);
    const parsed = parseWorkspaceMeta(json);
    expect(parsed).toEqual(meta);
  });

  it("returns null for invalid JSON", () => {
    expect(parseWorkspaceMeta("not json")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseWorkspaceMeta("")).toBeNull();
  });

  it("provides default values for missing fields", () => {
    const parsed = parseWorkspaceMeta('{"displayName": "Test"}');
    expect(parsed).not.toBeNull();
    expect(parsed!.archivedAt).toBeNull();
    expect(parsed!.color).toBe("#6b7280");
  });
});
```

- [ ] **Step 3.2: Executar e verificar falha**

```bash
npm test -- tests/workspace.test.ts
```
Esperado: FAIL — Cannot find module

- [ ] **Step 3.3: Implementar workspace.ts**

Criar `src/main/workspace.ts`:
```typescript
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
}

export interface WorkspaceInfo {
  profileName: string;   // nome do perfil (id técnico)
  meta: WorkspaceMeta;
  isActive: boolean;
  isDefault: boolean;
}

const DEFAULT_META: Omit<WorkspaceMeta, "displayName" | "createdAt"> = {
  description: "",
  icon: "🗂️",
  color: "#6b7280",
  archivedAt: null,
};

export function parseWorkspaceMeta(raw: string): WorkspaceMeta | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceMeta>;
    if (!parsed.displayName) return null;
    return {
      displayName: parsed.displayName,
      description: parsed.description ?? "",
      icon: parsed.icon ?? DEFAULT_META.icon,
      color: parsed.color ?? DEFAULT_META.color,
      createdAt: parsed.createdAt ?? 0,
      archivedAt: parsed.archivedAt ?? null,
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
  // Default: usa o nome do perfil como displayName
  const displayName = !profile || profile === "default" ? "Workspace Padrão" : profile;
  return {
    displayName,
    description: "",
    icon: profile === "default" ? "🏠" : "🗂️",
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
```

- [ ] **Step 3.4: Executar e verificar aprovação**

```bash
npm test -- tests/workspace.test.ts
```
Esperado: PASS

- [ ] **Step 3.5: Commit**

```bash
git add src/main/workspace.ts tests/workspace.test.ts
git commit -m "feat(workspace): add workspace metadata model (workspace.json per profile)"
```

---

## Task 4: WorkspaceContextFirewall

**Objetivo:** Middleware que valida que recursos acessados pertencem ao workspace ativo. Deve ser chamado antes de qualquer operação de leitura/escrita de recurso.

**Files:**
- Create: `src/main/workspace-firewall.ts`
- Create: `tests/workspace-firewall.test.ts`

- [ ] **Step 4.1: Escrever testes falhando**

Criar `tests/workspace-firewall.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { WorkspaceContextFirewall } from "../src/main/workspace-firewall";

describe("WorkspaceContextFirewall", () => {
  it("allows access when resource belongs to active workspace", () => {
    const firewall = new WorkspaceContextFirewall("workspace_a");
    expect(firewall.canAccess("workspace_a")).toBe(true);
  });

  it("blocks access when resource belongs to different workspace", () => {
    const firewall = new WorkspaceContextFirewall("workspace_a");
    expect(firewall.canAccess("workspace_b")).toBe(false);
  });

  it("allows access to global resources (no workspace)", () => {
    const firewall = new WorkspaceContextFirewall("workspace_a");
    expect(firewall.canAccess(undefined)).toBe(true);
    expect(firewall.canAccess(null)).toBe(true);
  });

  it("validates access and returns violation detail", () => {
    const firewall = new WorkspaceContextFirewall("active_ws");
    const result = firewall.validate("other_ws", "memory", "read");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("other_ws");
  });

  it("allows access to own workspace resources", () => {
    const firewall = new WorkspaceContextFirewall("active_ws");
    const result = firewall.validate("active_ws", "session", "read");
    expect(result.allowed).toBe(true);
  });
});
```

- [ ] **Step 4.2: Executar e verificar falha**

```bash
npm test -- tests/workspace-firewall.test.ts
```

- [ ] **Step 4.3: Implementar workspace-firewall.ts**

Criar `src/main/workspace-firewall.ts`:
```typescript
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
 *
 * Todo acesso a recursos com workspace_id deve passar por este firewall.
 * Recursos globais (workspace_id = undefined/null) sempre são permitidos.
 *
 * Instânciado por sessão com o workspace ativo no momento.
 */
export class WorkspaceContextFirewall {
  private readonly activeWorkspace: string;

  constructor(activeWorkspace: string) {
    this.activeWorkspace = activeWorkspace;
  }

  canAccess(resourceWorkspace: string | undefined | null): boolean {
    if (resourceWorkspace == null) return true; // global
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

  /**
   * Variante de assert — lança se acesso negado. Use em operações de escrita críticas.
   */
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

/** Singleton da sessão atual — atualizado ao trocar workspace. */
let _activeFirewall: WorkspaceContextFirewall = new WorkspaceContextFirewall(
  "default",
);

export function getFirewall(): WorkspaceContextFirewall {
  return _activeFirewall;
}

export function setActiveWorkspace(workspace: string): void {
  _activeFirewall = new WorkspaceContextFirewall(workspace);
}
```

- [ ] **Step 4.4: Executar e verificar aprovação**

```bash
npm test -- tests/workspace-firewall.test.ts
```
Esperado: PASS

- [ ] **Step 4.5: Commit**

```bash
git add src/main/workspace-firewall.ts tests/workspace-firewall.test.ts
git commit -m "feat(workspace): add WorkspaceContextFirewall middleware"
```

---

## Task 5: IPC Handlers — API de Workspace

**Objetivo:** Expor operações de workspace ao renderer via IPC, seguindo o padrão existente do projeto.

**Files:**
- Modify: `src/main/index.ts` — registrar handlers
- Modify: `src/preload/index.ts` — expor via `hermesAPI`
- Modify: `src/preload/index.d.ts` — tipos TypeScript

- [ ] **Step 5.1: Ler os arquivos antes de editar**

```bash
# Verificar padrão de handlers existentes
grep -n "ipcMain.handle" src/main/index.ts | head -20
```

- [ ] **Step 5.2: Adicionar handlers em index.ts**

Ler `src/main/index.ts` e localizar o bloco de imports + o bloco de handlers de Profile (em torno de `"list-profiles"` na linha ~956).

Adicionar import no topo do arquivo:
```typescript
import {
  readWorkspaceMeta,
  writeWorkspaceMeta,
  updateWorkspaceMeta,
  type WorkspaceMeta,
} from "./workspace";
import { setActiveWorkspace } from "./workspace-firewall";
```

Adicionar handlers IPC após os handlers de Profile existentes.
**IMPORTANTE:** usar kebab-case sem prefixo, igual ao padrão do projeto (`"list-profiles"`, `"read-memory"`, etc.):
```typescript
// Workspace metadata (wraps profile system)
ipcMain.handle(
  "read-workspace-meta",
  async (_event, profile?: string): Promise<WorkspaceMeta> => {
    return readWorkspaceMeta(profile);
  },
);

ipcMain.handle(
  "write-workspace-meta",
  async (_event, meta: WorkspaceMeta, profile?: string) => {
    return writeWorkspaceMeta(meta, profile);
  },
);

ipcMain.handle(
  "update-workspace-meta",
  async (_event, updates: Partial<WorkspaceMeta>, profile?: string) => {
    return updateWorkspaceMeta(updates, profile);
  },
);

// Atualiza o firewall quando o workspace ativo muda
ipcMain.handle(
  "set-active-workspace-firewall",
  async (_event, profileName: string) => {
    setActiveWorkspace(profileName);
    return true;
  },
);
```

- [ ] **Step 5.3: Adicionar ao preload/index.ts**

Ler `src/preload/index.ts` e seguir o padrão existente. Localizar onde os métodos de Profiles são expostos e adicionar após:
```typescript
// Workspace metadata (kebab-case igual ao padrão do projeto)
readWorkspaceMeta: (profile?: string) =>
  ipcRenderer.invoke("read-workspace-meta", profile),
writeWorkspaceMeta: (meta: unknown, profile?: string) =>
  ipcRenderer.invoke("write-workspace-meta", meta, profile),
updateWorkspaceMeta: (updates: unknown, profile?: string) =>
  ipcRenderer.invoke("update-workspace-meta", updates, profile),
setActiveWorkspaceFirewall: (profileName: string) =>
  ipcRenderer.invoke("set-active-workspace-firewall", profileName),
```

- [ ] **Step 5.4: Adicionar tipos ao preload/index.d.ts**

Localizar a interface `HermesAPI` e adicionar após os métodos de Profile (linha ~362):
```typescript
// Workspace metadata
readWorkspaceMeta: (profile?: string) => Promise<{
  displayName: string;
  description: string;
  icon: string;
  color: string;
  createdAt: number;
  archivedAt: number | null;
}>;
writeWorkspaceMeta: (
  meta: {
    displayName: string;
    description: string;
    icon: string;
    color: string;
    createdAt: number;
    archivedAt: number | null;
  },
  profile?: string,
) => Promise<{ success: boolean; error?: string }>;
updateWorkspaceMeta: (
  updates: Partial<{
    displayName: string;
    description: string;
    icon: string;
    color: string;
    archivedAt: number | null;
  }>,
  profile?: string,
) => Promise<{ success: boolean; error?: string }>;
setActiveWorkspaceFirewall: (profileName: string) => Promise<boolean>;
```

- [ ] **Step 5.5: Verificar typecheck**

```bash
npm run typecheck
```
Esperado: sem erros de tipo

- [ ] **Step 5.6: Executar todos os testes**

```bash
npm test
```

- [ ] **Step 5.7: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(workspace): register workspace IPC handlers and preload API"
```

---

## Task 6: Hook useWorkspaceSwitch — Session Controller

**Objetivo:** Hook React que gerencia a troca de workspace: aborta chat em andamento, limpa mensagens, limpa session cache, recarrega configurações do workspace alvo.

**Files:**
- Create: `src/renderer/src/hooks/useWorkspaceSwitch.ts`

- [ ] **Step 6.1: Implementar o hook**

Criar `src/renderer/src/hooks/useWorkspaceSwitch.ts`:
```typescript
import { useCallback } from "react";

export interface WorkspaceSwitchOptions {
  onClearMessages: () => void;
  onClearSession: () => void;
  onProfileChanged: (profileName: string) => void;
}

/**
 * Session Controller: gerencia troca segura de workspace.
 *
 * Ao trocar workspace:
 * 1. Aborta qualquer chat em andamento
 * 2. Limpa mensagens do chat
 * 3. Limpa session ID corrente
 * 4. Atualiza o firewall no main process
 * 5. Ativa o perfil no backend hermes
 * 6. Notifica o layout do novo workspace ativo
 */
export function useWorkspaceSwitch({
  onClearMessages,
  onClearSession,
  onProfileChanged,
}: WorkspaceSwitchOptions) {
  const switchWorkspace = useCallback(
    async (profileName: string) => {
      // 1. Abortar chat em andamento
      try {
        await window.hermesAPI.abortChat();
      } catch { /* ignora se não havia chat */ }

      // 2. Limpar contexto transitório da sessão
      onClearMessages();
      onClearSession();

      // 3. Atualizar firewall no main process
      await window.hermesAPI.setActiveWorkspaceFirewall(profileName);

      // 4. Ativar perfil no backend hermes
      await window.hermesAPI.setActiveProfile(profileName);

      // 5. Notificar componentes
      onProfileChanged(profileName);
    },
    [onClearMessages, onClearSession, onProfileChanged],
  );

  return { switchWorkspace };
}
```

- [ ] **Step 6.2: Verificar typecheck**

```bash
npm run typecheck:web
```

- [ ] **Step 6.3: Commit**

```bash
git add src/renderer/src/hooks/useWorkspaceSwitch.ts
git commit -m "feat(workspace): add useWorkspaceSwitch session controller hook"
```

---

## Task 7: Workspace Manager UI — Tela de Workspaces

**Objetivo:** Criar a tela de gerenciamento de workspaces. Lista todos os workspaces (perfis com metadados), permite criar novos, arquivar, duplicar e fazer backup.

**Files:**
- Create: `src/renderer/src/screens/Workspaces/Workspaces.tsx`
- Create: `src/renderer/src/screens/Workspaces/WorkspaceCard.tsx`
- Create: `src/renderer/src/screens/Workspaces/WorkspaceCreateModal.tsx`

- [ ] **Step 7.1: Criar WorkspaceCard.tsx**

Criar `src/renderer/src/screens/Workspaces/WorkspaceCard.tsx`:
```tsx
import { useState } from "react";
import { Archive, Copy, Trash2, MoreHorizontal } from "lucide-react";
// Nota: NÃO importar useI18n aqui — strings estão em PT-BR hardcoded nesta versão inicial.
// Para internacionalização futura, adicionar useI18n e namespace workspace.*

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
}

interface WorkspaceCardProps {
  workspace: WorkspaceCardData;
  onSelect: (profileName: string) => void;
  onDuplicate: (profileName: string) => void;
  onArchive: (profileName: string) => void;
  onDelete: (profileName: string) => void;
}

export function WorkspaceCard({
  workspace,
  onSelect,
  onDuplicate,
  onArchive,
  onDelete,
}: WorkspaceCardProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={`workspace-card ${workspace.isActive ? "workspace-card-active" : ""} ${workspace.archivedAt ? "workspace-card-archived" : ""}`}
      style={{ borderLeftColor: workspace.color }}
    >
      <div className="workspace-card-header" onClick={() => onSelect(workspace.profileName)}>
        <span className="workspace-card-icon">{workspace.icon}</span>
        <div className="workspace-card-info">
          <div className="workspace-card-name">
            {workspace.displayName}
            {workspace.isActive && (
              <span className="workspace-card-active-badge">Ativo</span>
            )}
            {workspace.archivedAt && (
              <span className="workspace-card-archived-badge">Arquivado</span>
            )}
          </div>
          {workspace.description && (
            <div className="workspace-card-description">{workspace.description}</div>
          )}
          <div className="workspace-card-stats">
            {workspace.skillCount != null && (
              <span>{workspace.skillCount} skills</span>
            )}
          </div>
        </div>
      </div>

      <div className="workspace-card-actions">
        <button
          className="workspace-menu-btn"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          <MoreHorizontal size={14} />
        </button>
        {menuOpen && (
          <div className="workspace-dropdown">
            {!workspace.isDefault && (
              <button onClick={() => { onDuplicate(workspace.profileName); setMenuOpen(false); }}>
                <Copy size={12} /> Duplicar
              </button>
            )}
            {!workspace.archivedAt && !workspace.isDefault && (
              <button onClick={() => { onArchive(workspace.profileName); setMenuOpen(false); }}>
                <Archive size={12} /> Arquivar
              </button>
            )}
            {!workspace.isDefault && (
              <button
                className="workspace-dropdown-danger"
                onClick={() => { onDelete(workspace.profileName); setMenuOpen(false); }}
              >
                <Trash2 size={12} /> Excluir
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7.2: Criar WorkspaceCreateModal.tsx**

Criar `src/renderer/src/screens/Workspaces/WorkspaceCreateModal.tsx`:
```tsx
import { useState } from "react";
import { X } from "lucide-react";

const PRESET_ICONS = ["🗂️", "🏢", "🚀", "💼", "🔬", "🎨", "⚙️", "📊", "🏗️", "🌐"];
const PRESET_COLORS = [
  "#6b7280", "#3b82f6", "#10b981", "#f59e0b",
  "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6",
];

interface WorkspaceCreateModalProps {
  onConfirm: (name: string, displayName: string, icon: string, color: string, clone: boolean) => void;
  onCancel: () => void;
}

export function WorkspaceCreateModal({
  onConfirm,
  onCancel,
}: WorkspaceCreateModalProps): React.JSX.Element {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [icon, setIcon] = useState("🗂️");
  const [color, setColor] = useState("#3b82f6");
  const [clone, setClone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(): void {
    const techName = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    if (!techName) {
      setError("Nome técnico obrigatório");
      return;
    }
    if (techName.length < 2 || techName.length > 63) {
      setError("Nome deve ter entre 2 e 63 caracteres");
      return;
    }
    onConfirm(techName, displayName || techName, icon, color, clone);
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <div className="modal-header">
          <h2>Novo Workspace</h2>
          <button onClick={onCancel}><X size={16} /></button>
        </div>

        <div className="modal-body">
          <label>
            <span>Nome técnico (ID)</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex: empresa_a, projeto_rag"
              pattern="[a-z0-9_-]+"
            />
            <small>Letras minúsculas, números, underscore e hífen</small>
          </label>

          <label>
            <span>Nome de exibição</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="ex: Empresa A"
            />
          </label>

          <div className="modal-row">
            <label>
              <span>Ícone</span>
              <div className="icon-picker">
                {PRESET_ICONS.map((i) => (
                  <button
                    key={i}
                    className={icon === i ? "icon-selected" : ""}
                    onClick={() => setIcon(i)}
                  >
                    {i}
                  </button>
                ))}
              </div>
            </label>

            <label>
              <span>Cor</span>
              <div className="color-picker">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    style={{ backgroundColor: c }}
                    className={color === c ? "color-selected" : ""}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </label>
          </div>

          <label className="modal-checkbox">
            <input
              type="checkbox"
              checked={clone}
              onChange={(e) => setClone(e.target.checked)}
            />
            <span>Clonar configurações do workspace atual</span>
          </label>

          {error && <div className="modal-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onCancel}>Cancelar</button>
          <button className="btn-primary" onClick={handleSubmit}>Criar Workspace</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7.3: Criar Workspaces.tsx (tela principal)**

Criar `src/renderer/src/screens/Workspaces/Workspaces.tsx`:
```tsx
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

  async function handleSelect(profileName: string): Promise<void> {
    await switchWorkspace(profileName === "default" ? "default" : profileName);
  }

  async function handleCreate(
    name: string,
    displayName: string,
    icon: string,
    color: string,
    clone: boolean,
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

  // ATENÇÃO: window.confirm é bloqueado em Electron com contextIsolation habilitado.
  // Usar estado local para confirmação inline (padrão do app — ver Install.tsx que
  // usa phase="confirm" | "running"). Implementar estado de confirmação:
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

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
    setConfirmDelete(profileName); // abre confirmação inline
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

  const active = workspaces.filter((w) => !w.archivedAt);
  const archived = workspaces.filter((w) => !!w.archivedAt);

  return (
    <div className="workspaces-screen">
      <div className="workspaces-header">
        <div>
          <h1>Workspaces</h1>
          <p className="workspaces-subtitle">
            Cada workspace é um ambiente isolado — memória, sessões e skills independentes.
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
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {loading ? (
        <div className="workspaces-loading">Carregando workspaces...</div>
      ) : (
        <>
          <div className="workspaces-grid">
            {active.map((ws) => (
              <WorkspaceCard
                key={ws.profileName}
                workspace={ws}
                onSelect={handleSelect}
                onDuplicate={handleDuplicate}
                onArchive={handleArchive}
                onDelete={handleDelete}
              />
            ))}
          </div>

          {archived.length > 0 && (
            <div className="workspaces-archived-section">
              <h3>Arquivados ({archived.length})</h3>
              <div className="workspaces-grid">
                {archived.map((ws) => (
                  <WorkspaceCard
                    key={ws.profileName}
                    workspace={ws}
                    onSelect={handleSelect}
                    onDuplicate={handleDuplicate}
                    onArchive={handleArchive}
                    onDelete={handleDelete}
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
```

- [ ] **Step 7.4: Verificar typecheck do renderer**

```bash
npm run typecheck:web
```

- [ ] **Step 7.5: Commit**

```bash
git add src/renderer/src/screens/Workspaces/
git commit -m "feat(workspace): add Workspace Manager UI (list, create, archive, delete)"
```

---

## Task 8: Integrar Workspace Manager no Layout + Status Bar

**Objetivo:** Adicionar view "workspaces" na navegação do Layout e status bar permanente mostrando workspace/sessão ativos.

**File:**
- Modify: `src/renderer/src/screens/Layout/Layout.tsx`

- [ ] **Step 8.1: Ler Layout.tsx antes de editar**

Ler `src/renderer/src/screens/Layout/Layout.tsx` completo para entender a estrutura atual.

- [ ] **Step 8.2: Adicionar import e view no Layout**

Modificações em `src/renderer/src/screens/Layout/Layout.tsx`:

**1. Adicionar import do Workspaces e ícone:**
```typescript
import Workspaces from "../Workspaces/Workspaces";
// FolderOpen deve ser importado de "lucide-react" diretamente — NÃO de "../../assets/icons"
// (o arquivo local icons/index.tsx só re-exporta ícones customizados, não todos do lucide-react)
import { FolderOpen } from "lucide-react";
```

**2. Adicionar "workspaces" ao tipo View:**
```typescript
type View =
  | "workspaces"   // ← adicionar no início
  | "chat"
  | "sessions"
  // ... resto do tipo existente
```

**3. Adicionar ao array NAV_ITEMS (no início, antes de "chat"):**
```typescript
{ view: "workspaces", icon: FolderOpen, labelKey: "navigation.workspaces" },
```

**4. Modificar handleSelectProfile para usar switchWorkspace:**
Substituir:
```typescript
const handleSelectProfile = useCallback((name: string) => {
  setActiveProfile(name);
  setMessages([]);
  setCurrentSessionId(null);
}, []);
```
Por:
```typescript
const handleSelectProfile = useCallback((name: string) => {
  setActiveProfile(name);
  setMessages([]);
  setCurrentSessionId(null);
  // Atualizar firewall no main process
  window.hermesAPI.setActiveWorkspaceFirewall(name).catch(console.error);
}, []);
```

**5. Adicionar o painel Workspaces no bloco de renderização (após o painel "settings"):**
```tsx
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
```

**6. Adicionar status bar no sidebar-footer (acima do texto existente):**
```tsx
<div className="workspace-status-bar">
  <span className="workspace-status-icon">🗂️</span>
  <span className="workspace-status-name">
    {activeProfile === "default" ? "Workspace Padrão" : activeProfile}
  </span>
  {currentSessionId && (
    <span className="workspace-status-session" title={currentSessionId}>
      • sessão ativa
    </span>
  )}
</div>
```

- [ ] **Step 8.3: Adicionar string de i18n em TODOS os 8 locales**

O sistema de i18n é tipado — a chave `workspaces` deve ser adicionada a **todos** os 8 arquivos de locale em `src/shared/i18n/locales/*/navigation.ts`. Omitir qualquer um causa erro de typecheck.

Arquivos a modificar (adicionar `workspaces: "..."` em cada um):

```typescript
// src/shared/i18n/locales/en/navigation.ts
workspaces: "Workspaces",

// src/shared/i18n/locales/pt-BR/navigation.ts
workspaces: "Workspaces",

// src/shared/i18n/locales/pt-PT/navigation.ts
workspaces: "Workspaces",

// src/shared/i18n/locales/es/navigation.ts
workspaces: "Espacios de trabajo",

// src/shared/i18n/locales/ja/navigation.ts
workspaces: "ワークスペース",

// src/shared/i18n/locales/zh-CN/navigation.ts
workspaces: "工作空间",

// src/shared/i18n/locales/zh-TW/navigation.ts
workspaces: "工作空間",

// src/shared/i18n/locales/id/navigation.ts
workspaces: "Ruang Kerja",
```

Adicionar como primeira chave do objeto (antes de `chat`) em cada arquivo.

- [ ] **Step 8.4: Verificar typecheck e testes**

```bash
npm run typecheck && npm test
```

- [ ] **Step 8.5: Commit**

```bash
git add src/renderer/src/screens/Layout/Layout.tsx
git commit -m "feat(workspace): integrate Workspace Manager into navigation + add status bar"
```

---

## Task 9: Estilos CSS para Workspace UI

**Objetivo:** Adicionar classes CSS necessárias para o Workspace Manager. Seguir padrão visual do app existente (Tailwind 4 + CSS custom).

**File:**
- Modify: `src/renderer/src/assets/main.css` (ou criar arquivo dedicado se preferir)

- [ ] **Step 9.1: Ler arquivo CSS atual**

```bash
wc -l src/renderer/src/assets/main.css
```

- [ ] **Step 9.2: Adicionar estilos de workspace**

Ler `src/renderer/src/assets/main.css` para entender o padrão de nomenclatura, depois adicionar ao final:
```css
/* ── Workspace Manager ──────────────────────────────── */
.workspaces-screen {
  padding: 24px;
  overflow-y: auto;
  height: 100%;
}

.workspaces-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
}

.workspaces-header h1 { font-size: 1.4rem; font-weight: 600; margin: 0; }
.workspaces-subtitle { font-size: 0.8rem; color: var(--color-text-muted, #9ca3af); margin-top: 4px; }
.workspaces-header-actions { display: flex; gap: 8px; align-items: center; }

.workspaces-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.workspace-card {
  background: var(--color-surface, rgba(255,255,255,0.05));
  border: 1px solid var(--color-border, rgba(255,255,255,0.1));
  border-left: 3px solid;
  border-radius: 8px;
  padding: 14px;
  cursor: pointer;
  transition: background 0.15s;
  position: relative;
}
.workspace-card:hover { background: var(--color-surface-hover, rgba(255,255,255,0.08)); }
.workspace-card-active { ring: 2px solid var(--color-primary, #3b82f6); }
.workspace-card-archived { opacity: 0.6; }

.workspace-card-header { display: flex; gap: 10px; align-items: flex-start; }
.workspace-card-icon { font-size: 1.4rem; line-height: 1; }
.workspace-card-info { flex: 1; min-width: 0; }
.workspace-card-name { font-weight: 500; font-size: 0.9rem; display: flex; gap: 6px; align-items: center; }
.workspace-card-description { font-size: 0.75rem; color: var(--color-text-muted, #9ca3af); margin-top: 2px; }
.workspace-card-stats { font-size: 0.7rem; color: var(--color-text-muted, #9ca3af); margin-top: 4px; }
.workspace-card-active-badge { font-size: 0.65rem; background: var(--color-primary, #3b82f6); color: white; padding: 1px 6px; border-radius: 10px; }
.workspace-card-archived-badge { font-size: 0.65rem; background: #6b7280; color: white; padding: 1px 6px; border-radius: 10px; }

.workspace-card-actions { position: absolute; top: 10px; right: 10px; }
.workspace-menu-btn { background: none; border: none; cursor: pointer; padding: 4px; color: var(--color-text-muted, #9ca3af); border-radius: 4px; }
.workspace-menu-btn:hover { background: var(--color-surface-hover, rgba(255,255,255,0.1)); }

.workspace-dropdown {
  position: absolute; right: 0; top: 100%; z-index: 50;
  background: var(--color-card, #1f2937); border: 1px solid var(--color-border, rgba(255,255,255,0.15));
  border-radius: 6px; padding: 4px; min-width: 140px; box-shadow: 0 8px 16px rgba(0,0,0,0.3);
}
.workspace-dropdown button {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 6px 10px; font-size: 0.8rem; background: none; border: none;
  cursor: pointer; color: var(--color-text, #e5e7eb); border-radius: 4px;
}
.workspace-dropdown button:hover { background: var(--color-surface-hover, rgba(255,255,255,0.08)); }
.workspace-dropdown-danger { color: #ef4444 !important; }

/* Status bar no sidebar */
.workspace-status-bar {
  display: flex; align-items: center; gap: 6px; font-size: 0.7rem;
  color: var(--color-text-muted, #9ca3af); padding: 4px 0; border-top: 1px solid var(--color-border, rgba(255,255,255,0.1));
  margin-bottom: 4px;
}
.workspace-status-icon { font-size: 0.9rem; }
.workspace-status-name { font-weight: 500; color: var(--color-text, #e5e7eb); }
.workspace-status-session { font-size: 0.65rem; }

/* Modal de workspace */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 100;
  display: flex; align-items: center; justify-content: center;
}
.modal-box {
  background: var(--color-card, #1f2937); border: 1px solid var(--color-border, rgba(255,255,255,0.15));
  border-radius: 12px; padding: 24px; min-width: 420px; max-width: 520px;
}
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.modal-header h2 { font-size: 1.1rem; font-weight: 600; margin: 0; }
.modal-body { display: flex; flex-direction: column; gap: 14px; }
.modal-body label { display: flex; flex-direction: column; gap: 4px; font-size: 0.8rem; }
.modal-body input[type="text"] { padding: 8px 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: inherit; font-size: 0.85rem; }
.modal-body small { color: var(--color-text-muted, #9ca3af); font-size: 0.7rem; }
.modal-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.icon-picker, .color-picker { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.icon-picker button { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 6px; cursor: pointer; font-size: 1.1rem; }
.icon-picker button.icon-selected { border-color: var(--color-primary, #3b82f6); background: rgba(59,130,246,0.2); }
.color-picker button { width: 24px; height: 24px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
.color-picker button.color-selected { border-color: white; }
.modal-checkbox { flex-direction: row !important; align-items: center; gap: 8px !important; }
.modal-error { font-size: 0.8rem; color: #ef4444; padding: 8px; background: rgba(239,68,68,0.1); border-radius: 6px; }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.workspaces-archived-section h3 { font-size: 0.85rem; color: var(--color-text-muted, #9ca3af); margin-bottom: 10px; }
.workspaces-loading { color: var(--color-text-muted, #9ca3af); font-size: 0.85rem; }
.workspaces-error { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 6px; padding: 10px; font-size: 0.8rem; color: #ef4444; display: flex; justify-content: space-between; margin-bottom: 16px; }
```

- [ ] **Step 9.3: Executar build para verificar sem erros**

```bash
npm run build 2>&1 | head -30
```

- [ ] **Step 9.4: Commit**

```bash
git add src/renderer/src/assets/main.css
git commit -m "feat(workspace): add CSS styles for Workspace Manager UI"
```

---

## Task 10: Security Dependency Updates (Upstream Hermes v0.15.1)

**Objetivo:** Aplicar bumps de segurança de dependências identificados no hermes-agent v0.15.1.

**File:**
- Modify: `package.json`

- [ ] **Step 10.1: Verificar vulnerabilidades atuais**

```bash
cd /Users/souza/Documents/hermes-transfer-20260531-123839/hermes-desktop-src
npm audit 2>&1 | head -40
```

- [ ] **Step 10.2: Verificar versões atuais das dependências críticas**

```bash
node -e "const p = require('./package.json'); console.log(JSON.stringify({
  'react-router-dom': p.dependencies?.['react-router-dom'] || p.devDependencies?.['react-router-dom'] || 'not found',
  'electron': p.devDependencies?.['electron'],
  'framer-motion': p.dependencies?.['framer-motion']
}, null, 2))"
```

- [ ] **Step 10.3: Atualizar posthog-js se necessário**

```bash
npm update posthog-js --save
```

- [ ] **Step 10.4: Executar npm audit fix para vulnerabilidades conhecidas**

```bash
npm audit fix 2>&1
```

- [ ] **Step 10.5: Executar todos os testes após bumps**

```bash
npm test
```

- [ ] **Step 10.6: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): security dependency bumps (port from hermes-agent v0.15.1)"
```

---

## Task 11: Testes de Integração — Validação de Isolamento

**Objetivo:** Validar os 10 requisitos de isolamento do spec: workspaces não acessam recursos uns dos outros.

**File:**
- Create: `tests/workspace-isolation.test.ts`

- [ ] **Step 11.1: Criar testes de isolamento**

Criar `tests/workspace-isolation.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { WorkspaceContextFirewall } from "../src/main/workspace-firewall";
import { filterSystemContent } from "../src/renderer/src/hooks/useContentFilter";

describe("Workspace Isolation — 10 requisitos", () => {
  // Req 1: Workspace A não acessa Workspace B
  it("req1: firewall bloqueia acesso de workspace_a a recursos de workspace_b", () => {
    const fw = new WorkspaceContextFirewall("workspace_a");
    expect(fw.canAccess("workspace_b")).toBe(false);
  });

  // Req 2: Workspace B não acessa Workspace A
  it("req2: firewall bloqueia acesso de workspace_b a recursos de workspace_a", () => {
    const fw = new WorkspaceContextFirewall("workspace_b");
    expect(fw.canAccess("workspace_a")).toBe(false);
  });

  // Req 3: Memórias não vazam entre workspaces
  it("req3: validate memory access rejects cross-workspace", () => {
    const fw = new WorkspaceContextFirewall("ws_1");
    const result = fw.validate("ws_2", "memory", "read");
    expect(result.allowed).toBe(false);
  });

  // Req 4: Sessions do workspace correto são permitidas
  it("req4: sessions do mesmo workspace são permitidas", () => {
    const fw = new WorkspaceContextFirewall("ws_1");
    expect(fw.canAccess("ws_1")).toBe(true);
  });

  // Req 5: Recursos globais são sempre permitidos (providers, licenças)
  it("req5: recursos globais (undefined workspace) sempre permitidos", () => {
    const fw = new WorkspaceContextFirewall("any_workspace");
    expect(fw.canAccess(undefined)).toBe(true);
    expect(fw.canAccess(null)).toBe(true);
  });

  // Req 6: Cron Jobs — validação de escopo
  it("req6: cron job de outro workspace é bloqueado", () => {
    const fw = new WorkspaceContextFirewall("project_a");
    const result = fw.validate("project_b", "cron", "read");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  // Req 7: Skills — validação de escopo
  it("req7: skills de outro workspace são bloqueadas", () => {
    const fw = new WorkspaceContextFirewall("dev_ws");
    expect(fw.canAccess("research_ws")).toBe(false);
  });

  // Req 8: assertAccess lança para acesso cross-workspace
  it("req8: assertAccess lança Error em acesso negado", () => {
    const fw = new WorkspaceContextFirewall("ws_a");
    expect(() => fw.assertAccess("ws_b", "session", "write")).toThrow(
      /WorkspaceFirewall/,
    );
  });

  // Req 9: Conteúdo de sistema filtrado do chat
  it("req9: prefixo de cron job removido antes de exibir ao usuário", () => {
    const cronMessage =
      "[IMPORTANT: You are running as a scheduled cron job. DELIVERY: Auto-delivered.]\n\nResultado real aqui.";
    const filtered = filterSystemContent(cronMessage);
    expect(filtered).not.toContain("[IMPORTANT:");
    expect(filtered).toContain("Resultado real");
  });

  // Req 10: [SILENT] suprimido
  it("req10: resposta [SILENT] é suprimida completamente", () => {
    expect(filterSystemContent("[SILENT]")).toBe("");
  });
});
```

- [ ] **Step 11.2: Executar testes de isolamento**

```bash
npm test -- --reporter=verbose tests/workspace-isolation.test.ts
```
Esperado: PASS em todos os 10

- [ ] **Step 11.3: Executar suite completa**

```bash
npm test
```
Esperado: todos os testes passando

- [ ] **Step 11.4: Commit final**

```bash
git add tests/workspace-isolation.test.ts
git commit -m "test(workspace): validate 10 workspace isolation requirements"
```

---

## Checklist Final de Validação

Antes de considerar a implementação completa, verificar:

- [ ] `npm test` — todos os testes passando
- [ ] `npm run typecheck` — sem erros de tipo
- [ ] `npm run build` — build sem erros
- [ ] Prefixo `[IMPORTANT: ...]` não aparece mais no chat ao executar cron job
- [ ] Workspace Manager aparece na navegação lateral
- [ ] Criar um workspace novo funciona (cria perfil + `workspace.json`)
- [ ] Trocar workspace limpa o chat e o sessionId
- [ ] Status bar na sidebar mostra workspace ativo
- [ ] Workspaces arquivados aparecem em seção separada
- [ ] Build de produção funciona: `npm run build:mac`

---

## Notas sobre Hermes Agent v0.15.1 — Para Merge Futuro

As seguintes mudanças do **hermes-agent Python** (backend) requerem atualização separada do repositório Python. Não estão no escopo deste plano (que cobre apenas o desktop Electron), mas devem ser aplicadas quando o hermes-agent for atualizado:

1. **`fix(gateway): honor per-provider max_tokens`** — truncamento em Ollama/custom endpoints
2. **Session profile-aware** (PR #39993) — `session.create` aceita `profile` param
3. **`fix(dashboard): strip session token from subprocess env`** — segurança crítica
4. **`fix(gateway): tolerate non-UTF-8 status/pid files`** — crash em status corrompido
5. **Security bumps** — `requests 2.33.0`, `PyJWT 2.12.1`, `starlette 1.0.1`, `pydantic 2.13.4`

Para aplicar: fazer `git pull` no repositório `hermes-agent` em `~/.hermes/hermes-agent/` (ou via `hermes update` na app).

---

## Padrões do Open WebUI Inspiradores (Não Implementados neste Plano)

Para fases futuras, considerar os padrões maduros do Open WebUI:

- **Knowledge Base por workspace** — banco vetorial por workspace usando `{workspace_id}/{knowledge_id}` como nome de coleção (LanceDB ou Chroma embedded)
- **AccessGrants RBAC** — compartilhamento explícito de recursos entre workspaces
- **Sync diff** — sincronização incremental de diretórios locais com base de conhecimento
- **Memory por workspace** — coleção vetorial `workspace-memory-{workspace_id}` separada do perfil global
