/**
 * n8n.ts — Souza/JS.
 *
 * Lightweight bridge from Hermes Desktop to a locally-running n8n instance
 * so the user can see their workflows and trigger them inline alongside
 * Hermes-native agent profiles in the Agents screen.
 *
 * Configuration lives in ~/.hermes/.env:
 *   N8N_URL=http://localhost:5678
 *   N8N_API_KEY=<personal API key from n8n Settings → API>
 *
 * Without those vars the bridge no-ops cleanly (returns empty list / error
 * object the renderer can render as "configure first").
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface N8nWorkflow {
  id: string | number;
  name: string;
  active: boolean;
  tags?: string[];
  updatedAt?: string;
}

interface N8nConfig {
  url: string;
  apiKey: string;
}

/** Read a key from ~/.hermes/.env without pulling in dotenv. */
function readEnvVar(name: string): string {
  const envPath = join(homedir(), ".hermes", ".env");
  if (!existsSync(envPath)) return "";
  try {
    const text = readFileSync(envPath, "utf-8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      if (key !== name) continue;
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return value;
    }
  } catch {
    /* ignore */
  }
  return "";
}

function readConfig(): N8nConfig | null {
  const url = readEnvVar("N8N_URL") || "http://localhost:5678";
  const apiKey = readEnvVar("N8N_API_KEY");
  if (!apiKey) return null;
  return { url: url.replace(/\/$/, ""), apiKey };
}

export interface ListWorkflowsResult {
  ok: boolean;
  configured: boolean;
  workflows: N8nWorkflow[];
  error?: string;
  url?: string;
}

export async function listN8nWorkflows(): Promise<ListWorkflowsResult> {
  const cfg = readConfig();
  if (!cfg) {
    return {
      ok: false,
      configured: false,
      workflows: [],
      error:
        "Configure N8N_API_KEY em ~/.hermes/.env. Pegue a chave em n8n → Settings → API.",
    };
  }
  try {
    const res = await fetch(`${cfg.url}/api/v1/workflows`, {
      headers: { "X-N8N-API-KEY": cfg.apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return {
        ok: false,
        configured: true,
        workflows: [],
        url: cfg.url,
        error: `n8n respondeu HTTP ${res.status}: ${await res.text().catch(() => "")}`,
      };
    }
    const body = await res.json();
    const raw = Array.isArray(body) ? body : body?.data || [];
    const workflows: N8nWorkflow[] = raw.map((w: Record<string, unknown>) => ({
      id: (w.id as string | number) ?? "",
      name: String(w.name ?? ""),
      active: Boolean(w.active),
      tags: Array.isArray(w.tags)
        ? (w.tags as Array<{ name?: string }>).map((t) => t.name || "").filter(Boolean)
        : undefined,
      updatedAt: typeof w.updatedAt === "string" ? w.updatedAt : undefined,
    }));
    return { ok: true, configured: true, workflows, url: cfg.url };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      workflows: [],
      url: cfg.url,
      error: `Falha ao chamar n8n: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export interface TriggerResult {
  ok: boolean;
  error?: string;
  executionId?: string;
}

/** Trigger a workflow by id. Uses the v1 REST endpoint (manual execution). */
export async function triggerN8nWorkflow(
  workflowId: string | number,
): Promise<TriggerResult> {
  const cfg = readConfig();
  if (!cfg) {
    return { ok: false, error: "n8n não configurado (N8N_API_KEY ausente)" };
  }
  try {
    const res = await fetch(
      `${cfg.url}/api/v1/workflows/${workflowId}/activate`,
      {
        method: "POST",
        headers: { "X-N8N-API-KEY": cfg.apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        error: `HTTP ${res.status}: ${await res.text().catch(() => "")}`,
      };
    }
    const body = await res.json().catch(() => ({}));
    return {
      ok: true,
      executionId:
        typeof body?.executionId === "string"
          ? body.executionId
          : typeof body?.id === "string"
            ? body.id
            : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
