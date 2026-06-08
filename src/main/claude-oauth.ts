/**
 * Autenticação via Claude Code CLI.
 *
 * Fluxo:
 * 1. Verificar se Claude Code CLI está instalado — instalar se necessário
 * 2. Tentar importar credenciais existentes (arquivo ou macOS Keychain)
 * 3. Se não encontrar, executar `claude auth login --claudeai` como subprocesso:
 *    - Captura a URL gerada pelo CLI (contém client_id único do usuário)
 *    - Abre o browser automaticamente
 *    - Usuário autentica e copia o código exibido em platform.claude.com
 *    - Código é enviado ao stdin do subprocesso
 *    - CLI troca o código pelo token e armazena
 *    - Hermes importa as credenciais armazenadas
 */

import { shell } from "electron";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir, platform as osPlatform } from "os";
import { execSync, spawn, ChildProcess } from "child_process";
import { readDesktopConfig, writeDesktopConfig } from "./config";

// ── Credential storage ────────────────────────────────────

export interface ClaudeOAuthCredential {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  email?: string;
}

export function getClaudeOAuthCredential(): ClaudeOAuthCredential | null {
  const config = readDesktopConfig();
  const token = config.claudeOAuthToken as string | undefined;
  if (!token) return null;
  return {
    accessToken: token,
    refreshToken: config.claudeOAuthRefreshToken as string | undefined,
    expiresAt: config.claudeOAuthExpiresAt as number | undefined,
    email: config.claudeOAuthEmail as string | undefined,
  };
}

export function saveClaudeOAuthCredential(cred: ClaudeOAuthCredential): void {
  const config = readDesktopConfig();
  config.claudeOAuthToken = cred.accessToken;
  if (cred.refreshToken) config.claudeOAuthRefreshToken = cred.refreshToken;
  if (cred.expiresAt) config.claudeOAuthExpiresAt = cred.expiresAt;
  if (cred.email) config.claudeOAuthEmail = cred.email;
  writeDesktopConfig(config);
}

export function clearClaudeOAuthCredential(): void {
  const config = readDesktopConfig();
  delete config.claudeOAuthToken;
  delete config.claudeOAuthRefreshToken;
  delete config.claudeOAuthExpiresAt;
  delete config.claudeOAuthEmail;
  writeDesktopConfig(config);
}

export function isClaudeOAuthAuthenticated(): boolean {
  const cred = getClaudeOAuthCredential();
  if (!cred?.accessToken) return false;
  if (cred.expiresAt && Date.now() > cred.expiresAt - 60_000) return false;
  return true;
}

// ── CLI Detection & Installation ─────────────────────────

export function checkClaudeCli(): { installed: boolean; path?: string } {
  // Check via which/where first
  try {
    const cmd = osPlatform() === "win32" ? "where claude 2>nul" : "which claude 2>/dev/null";
    const path = execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim();
    if (path) return { installed: true, path };
  } catch {
    // not in PATH
  }

  // Check common install locations
  const common =
    osPlatform() === "win32"
      ? []
      : [
          join(homedir(), ".local", "bin", "claude"),
          "/usr/local/bin/claude",
          "/opt/homebrew/bin/claude",
        ];
  for (const p of common) {
    if (existsSync(p)) return { installed: true, path: p };
  }
  return { installed: false };
}

export async function installClaudeCli(): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const os = osPlatform();
    let cmd: string;
    let args: string[];

    if (os === "win32") {
      cmd = "powershell";
      args = ["-NoProfile", "-Command", "irm https://claude.ai/install.ps1 | iex"];
    } else {
      cmd = "bash";
      args = ["-c", "curl -fsSL https://claude.ai/install.sh | bash"];
    }

    const proc = spawn(cmd, args, { stdio: "pipe" });
    const errChunks: string[] = [];
    proc.stderr?.on("data", (d: Buffer) => errChunks.push(d.toString()));
    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: errChunks.join("").slice(0, 400) || `Exit ${code}` });
      }
    });
    proc.on("error", (err: Error) => resolve({ success: false, error: String(err) }));
  });
}

// ── Import de credenciais existentes ─────────────────────

interface ClaudeCodeFileCredentials {
  oauthAccount?: {
    access_token?: string;
    refresh_token?: string;
    expires_at?: string | number;
    email_address?: string;
  };
  accessToken?: string;
}

function importFromFiles(): ClaudeOAuthCredential | null {
  const paths = [
    join(homedir(), ".claude", ".credentials.json"),
    join(homedir(), ".claude.json"),
  ];
  for (const credPath of paths) {
    if (!existsSync(credPath)) continue;
    try {
      const data = JSON.parse(readFileSync(credPath, "utf-8")) as ClaudeCodeFileCredentials;
      if (data.oauthAccount?.access_token) {
        const acct = data.oauthAccount;
        if (!acct.access_token) continue;
        const expiresAt =
          typeof acct.expires_at === "number"
            ? acct.expires_at * 1000
            : acct.expires_at
              ? new Date(acct.expires_at).getTime()
              : undefined;
        return {
          accessToken: acct.access_token,
          refreshToken: acct.refresh_token,
          expiresAt,
          email: acct.email_address,
        };
      }
      if (data.accessToken) return { accessToken: data.accessToken };
    } catch {
      // malformed — try next
    }
  }
  return null;
}

function importFromKeychain(): ClaudeOAuthCredential | null {
  if (osPlatform() !== "darwin") return null;
  const services = ["claude-code", "Claude Code", "anthropic.claude-code", "claude"];
  for (const svc of services) {
    try {
      const token = execSync(`security find-generic-password -s "${svc}" -w 2>/dev/null`, {
        encoding: "utf-8",
        timeout: 3000,
      }).trim();
      if (token) return { accessToken: token };
    } catch {
      // try next
    }
  }
  return null;
}

export function importFromClaudeCode(): ClaudeOAuthCredential | null {
  return importFromFiles() ?? importFromKeychain();
}

// ── Fluxo CLI subprocesso ────────────────────────────────

interface ActiveCliFlow {
  proc: ChildProcess;
  authUrl: string;
}

let activeCliFlow: ActiveCliFlow | null = null;

export type OAuthStartResult =
  | { status: "imported"; credential: ClaudeOAuthCredential }
  | { status: "pkce_started"; authUrl: string }
  | { status: "cli_not_found" }
  | { status: "error"; message: string };

const CLI_URL_RE = /https:\/\/claude\.(?:com|ai)\/cai\/oauth\/authorize\S+/;

/** PATH estendido para garantir que node/npm sejam encontrados quando o CLI é spawn do Electron */
function buildCliEnv(): NodeJS.ProcessEnv {
  const home = homedir();
  const extra = [
    join(home, ".local", "bin"),
    join(home, ".nvm", "versions", "node", "current", "bin"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
  return {
    ...process.env,
    PATH: [...extra, process.env.PATH ?? ""].join(":"),
    HOME: home,
    TERM: "xterm-256color",
  };
}

/**
 * Inicia autenticação.
 * – Se credenciais existirem → "imported"
 * – Se CLI não instalado → "cli_not_found"
 * – Caso contrário → executa `claude auth login --claudeai`, captura URL,
 *   abre browser e retorna "pkce_started" com a URL (para exibição).
 *   Use `submitOAuthCode(code)` para concluir.
 */
export async function startClaudeOAuth(
  _opts: { useSystemBrowser?: boolean } = {},
): Promise<OAuthStartResult> {
  // 1. Tentar importar credenciais existentes
  const imported = importFromClaudeCode();
  if (imported) {
    saveClaudeOAuthCredential(imported);
    return { status: "imported", credential: imported };
  }

  // 2. Verificar CLI
  const cli = checkClaudeCli();
  if (!cli.installed) {
    return { status: "cli_not_found" };
  }

  // Cancelar fluxo anterior se houver
  if (activeCliFlow) {
    try { activeCliFlow.proc.kill(); } catch { /* ignore */ }
    activeCliFlow = null;
  }

  // 3. Iniciar subprocesso do CLI com PATH estendido
  return new Promise((resolve) => {
    const proc = spawn(cli.path!, ["auth", "login", "--claudeai"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: buildCliEnv(),
    });

    let outputBuf = "";
    let resolved = false;

    const resolveOnce = (result: OAuthStartResult) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    const onData = (data: Buffer) => {
      outputBuf += data.toString();
      const match = outputBuf.match(CLI_URL_RE);
      if (match) {
        activeCliFlow = { proc, authUrl: match[0] };
        shell.openExternal(match[0]).catch(() => {});
        resolveOnce({ status: "pkce_started", authUrl: match[0] });
      }
    };

    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);

    proc.on("close", (code) => {
      if (!resolved) {
        resolveOnce({
          status: "error",
          message: outputBuf.slice(-400) || `CLI encerrou com código ${code}`,
        });
      }
    });

    proc.on("error", (err: Error) => {
      resolveOnce({ status: "error", message: String(err) });
    });

    // Timeout de 30 s para a URL aparecer
    setTimeout(() => {
      if (!resolved) {
        try { proc.kill(); } catch { /* ignore */ }
        resolveOnce({ status: "error", message: "Timeout: CLI não retornou URL em 30s — verifique se o Claude Code CLI está instalado e tente novamente" });
      }
    }, 30_000);
  });
}

/**
 * Recebe o código colado pelo usuário.
 * Envia ao stdin do subprocesso CLI e aguarda conclusão.
 * Após sucesso, importa as credenciais armazenadas pelo CLI.
 */
export async function submitOAuthCode(code: string): Promise<{
  success: boolean;
  credential?: ClaudeOAuthCredential;
  error?: string;
}> {
  if (!activeCliFlow) {
    return { success: false, error: "Nenhum fluxo de autenticação ativo — clique 'Autenticar' primeiro" };
  }

  const flow = activeCliFlow;
  activeCliFlow = null;

  // Se o processo já encerrou (exitCode !== null), o CLI completou antes de recebermos o código.
  // Pode ter salvo o token — tentar importar diretamente.
  if (flow.proc.exitCode !== null) {
    if (flow.proc.exitCode === 0) {
      const cred = importFromClaudeCode();
      if (cred) {
        saveClaudeOAuthCredential(cred);
        return { success: true, credential: cred };
      }
    }
    // Processo encerrou com erro ou sem salvar — executar nova tentativa com código embutido
    return submitCodeViaSeparateProcess(code);
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try { flow.proc.kill(); } catch { /* ignore */ }
      resolve({ success: false, error: "Timeout aguardando confirmação do CLI (45s)" });
    }, 45_000);

    const onClose = (exitCode: number | null): void => {
      clearTimeout(timeout);
      if (exitCode === 0) {
        const cred = importFromClaudeCode();
        if (cred) {
          saveClaudeOAuthCredential(cred);
          resolve({ success: true, credential: cred });
        } else {
          resolve({ success: true });
        }
      } else {
        resolve({ success: false, error: `CLI encerrou com código ${exitCode ?? "null"}` });
      }
    };

    flow.proc.once("close", onClose);
    flow.proc.once("error", (err: Error) => {
      clearTimeout(timeout);
      resolve({ success: false, error: String(err) });
    });

    // Escrever código no stdin do CLI
    try {
      flow.proc.stdin?.write(code.trim() + "\n");
      flow.proc.stdin?.end();
    } catch (err) {
      clearTimeout(timeout);
      flow.proc.removeListener("close", onClose);
      resolve({ success: false, error: `Erro ao enviar código: ${err}` });
    }
  });
}

/** Fallback: executa nova autenticação com o código já na entrada padrão */
async function submitCodeViaSeparateProcess(code: string): Promise<{
  success: boolean;
  credential?: ClaudeOAuthCredential;
  error?: string;
}> {
  const cli = checkClaudeCli();
  if (!cli.installed) {
    return { success: false, error: "Claude Code CLI não encontrado" };
  }
  return new Promise((resolve) => {
    const proc = spawn(cli.path!, ["auth", "login", "--claudeai"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: buildCliEnv(),
    });
    const timeout = setTimeout(() => {
      try { proc.kill(); } catch { /* ignore */ }
      resolve({ success: false, error: "Timeout no processo de autenticação de fallback" });
    }, 30_000);

    let buf = "";
    const onData = (d: Buffer): void => {
      buf += d.toString();
      // Quando o CLI pedir o código (exibindo o prompt ">"), enviar
      if (/Paste code|code here|\>/i.test(buf)) {
        try {
          proc.stdin?.write(code.trim() + "\n");
          proc.stdin?.end();
        } catch { /* ignore */ }
      }
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);

    proc.once("close", (exitCode) => {
      clearTimeout(timeout);
      if (exitCode === 0) {
        const cred = importFromClaudeCode();
        if (cred) {
          saveClaudeOAuthCredential(cred);
          resolve({ success: true, credential: cred });
        } else {
          resolve({ success: true });
        }
      } else {
        resolve({ success: false, error: buf.slice(-300) || `Código de saída ${exitCode}` });
      }
    });
    proc.once("error", (err: Error) => {
      clearTimeout(timeout);
      resolve({ success: false, error: String(err) });
    });
  });
}

// ── Retrocompatibilidade ─────────────────────────────────

/** @deprecated — use submitOAuthCode() */
export async function waitForClaudeOAuthCallback(): Promise<{
  success: boolean;
  credential?: ClaudeOAuthCredential;
  error?: string;
}> {
  return { success: false, error: "Use submitOAuthCode() — fluxo de callback local desativado" };
}

export function isPkceFlowPending(): boolean {
  return activeCliFlow !== null;
}

export function cancelPkceFlow(): void {
  if (activeCliFlow) {
    activeCliFlow.proc.kill();
    activeCliFlow = null;
  }
}
