import { join } from "path";
import { existsSync, mkdirSync, unlinkSync } from "fs";
import { spawn, ChildProcess, execSync } from "child_process";
import { homedir } from "os";
import { createServer } from "net";

const DEEPSPROXY_DIR = join(homedir(), ".hermes", "deepsproxy");
const DEEPSPROXY_REPO = "https://github.com/pedrofariasx/deepsproxy.git";

let proxyProcess: ChildProcess | null = null;
let loginProcess: ChildProcess | null = null;
let currentProxyPort = 3500;

function findAvailablePort(start: number, end: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = start;
    const tryPort = (): void => {
      if (port > end) {
        reject(new Error(`No available port in range ${start}-${end}`));
        return;
      }
      const server = createServer();
      server.once("error", () => { port++; tryPort(); });
      server.once("listening", () => {
        const addr = server.address() as { port: number };
        server.close(() => resolve(addr.port));
      });
      server.listen(port);
    };
    tryPort();
  });
}

export function getCurrentProxyPort(): number {
  return currentProxyPort;
}

function buildEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH || ""}`,
  };
}

function findExec(name: string): string {
  const candidates = [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    name,
  ];
  for (const c of candidates) {
    if (c !== name && existsSync(c)) return c;
  }
  return name;
}

function spawnCmd(
  cmd: string,
  args: string[],
  cwd: string | undefined,
  onData: (s: string) => void,
): Promise<number> {
  return new Promise((resolve) => {
    const env = buildEnv();
    const p = spawn(cmd, args, { cwd, env, shell: false });
    p.stdout?.on("data", (d: Buffer) => onData(d.toString()));
    p.stderr?.on("data", (d: Buffer) => onData(d.toString()));
    p.on("error", (err) => {
      onData(`[erro] ${cmd}: ${err.message}\n`);
      resolve(1);
    });
    p.on("close", (code) => resolve(code ?? 1));
  });
}

export function isDeepsProxyInstalled(): boolean {
  return (
    existsSync(DEEPSPROXY_DIR) &&
    existsSync(join(DEEPSPROXY_DIR, "node_modules")) &&
    existsSync(join(DEEPSPROXY_DIR, "src", "index.ts"))
  );
}

export async function checkDeepsProxyServer(): Promise<boolean> {
  try {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), 2000);
    const res = await fetch(`http://localhost:${currentProxyPort}/health`, {
      signal: ac.signal,
    });
    clearTimeout(tid);
    return res.ok;
  } catch {
    return false;
  }
}

export function isDeepsProxyProcessAlive(): boolean {
  return proxyProcess !== null && !proxyProcess.killed;
}

export async function installDeepsProxy(
  onData: (s: string) => void,
): Promise<void> {
  if (!existsSync(DEEPSPROXY_DIR)) {
    mkdirSync(DEEPSPROXY_DIR, { recursive: true });
  }

  const git = findExec("git");
  const hasGit = existsSync(join(DEEPSPROXY_DIR, ".git"));

  if (hasGit) {
    onData("[deepsproxy] Atualizando repositório…\n");
    await spawnCmd(git, ["-C", DEEPSPROXY_DIR, "pull"], undefined, onData);
  } else {
    onData("[deepsproxy] Clonando repositório…\n");
    const code = await spawnCmd(
      git,
      ["clone", "--depth", "1", DEEPSPROXY_REPO, DEEPSPROXY_DIR],
      undefined,
      onData,
    );
    if (code !== 0) {
      onData("[deepsproxy] Falha no git clone. Verifique conexão e Git.\n");
      return;
    }
  }

  onData("[deepsproxy] Instalando dependências (npm install)…\n");
  const npm = findExec("npm");
  const npmCode = await spawnCmd(npm, ["install"], DEEPSPROXY_DIR, onData);
  if (npmCode !== 0) {
    onData("[deepsproxy] Falha no npm install. Verifique o Node.js instalado.\n");
    return;
  }

  onData("[deepsproxy] Instalando Chromium (playwright)…\n");
  const npx = findExec("npx");
  await spawnCmd(npx, ["playwright", "install", "chromium"], DEEPSPROXY_DIR, onData);
  onData("[deepsproxy] Instalação concluída!\n");
}

export function startDeepsProxyLogin(onData: (s: string) => void, onComplete?: () => void): void {
  if (loginProcess && !loginProcess.killed) {
    onData("[deepsproxy-login] Processo de login já está rodando.\n");
    return;
  }
  const npx = findExec("npx");
  onData("[deepsproxy-login] Abrindo browser DeepSeek para autenticação…\n");
  loginProcess = spawn(npx, ["tsx", "src/login.ts"], {
    cwd: DEEPSPROXY_DIR,
    env: buildEnv(),
    detached: true,
  });
  loginProcess.stdout?.on("data", (d: Buffer) => onData(d.toString()));
  loginProcess.stderr?.on("data", (d: Buffer) => onData(d.toString()));
  loginProcess.on("error", (err) =>
    onData(`[deepsproxy-login] Erro: ${err.message}\n`),
  );
  loginProcess.on("close", (code) => {
    loginProcess = null;
    onData(`[deepsproxy-login] Processo encerrado (código ${code}).\n`);
    // code 0 = clean exit, null = killed by signal (also ok)
    if ((code === 0 || code === null) && onComplete) {
      onComplete();
    }
  });
}

export async function startDeepsProxy(onData: (s: string) => void): Promise<void> {
  if (proxyProcess && !proxyProcess.killed) {
    onData("[deepsproxy] Proxy já está rodando.\n");
    return;
  }
  const port = await findAvailablePort(3500, 4000).catch(() => 3500);
  currentProxyPort = port;
  const npx = findExec("npx");
  onData(`[deepsproxy] Iniciando servidor na porta ${port}…\n`);
  proxyProcess = spawn(npx, ["tsx", "src/index.ts"], {
    cwd: DEEPSPROXY_DIR,
    env: { ...buildEnv(), PORT: String(port) },
    detached: true,
  });
  proxyProcess.stdout?.on("data", (d: Buffer) => onData(d.toString()));
  proxyProcess.stderr?.on("data", (d: Buffer) => onData(d.toString()));
  proxyProcess.on("error", (err) =>
    onData(`[deepsproxy] Erro: ${err.message}\n`),
  );
  proxyProcess.on("close", (code) => {
    proxyProcess = null;
    onData(`[deepsproxy] Servidor encerrado (código ${code}).\n`);
  });
}

function killGroup(proc: ChildProcess): void {
  try {
    if (proc.pid) process.kill(-proc.pid, "SIGTERM");
  } catch {
    try { proc.kill("SIGTERM"); } catch { /* already dead */ }
  }
}

/** Graceful HTTP shutdown, then force-kill by process group or port. */
export async function stopDeepsProxy(): Promise<void> {
  // 1. Try graceful shutdown via HTTP endpoint (works even if proxyProcess is null,
  //    e.g. server was started by a previous Hermes session)
  try {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), 3000);
    await fetch(`http://localhost:${currentProxyPort}/shutdown`, { signal: ac.signal });
    clearTimeout(tid);
    // Give the process 1s to exit cleanly before force-killing
    await new Promise<void>((r) => setTimeout(r, 1000));
  } catch { /* server not reachable — proceed to force kill */ }

  // 2. Force-kill the managed process if we still have a reference
  if (proxyProcess) {
    killGroup(proxyProcess);
    proxyProcess = null;
  }

  // 3. Kill any lingering Chromium processes that still hold the profile lock
  try {
    execSync(`pkill -9 -f "deepseek_profile"`, { stdio: "ignore" });
  } catch { /* no matching processes — ignore */ }

  // 4. Wait for OS to release file locks
  await new Promise<void>((r) => setTimeout(r, 800));

  // 5. Delete the SingletonLock file so the next launch isn't blocked
  try {
    unlinkSync(join(DEEPSPROXY_DIR, "deepseek_profile", "SingletonLock"));
  } catch { /* file doesn't exist — ignore */ }
}

export async function killAllDeepsProxy(): Promise<void> {
  await stopDeepsProxy();
  if (loginProcess) {
    killGroup(loginProcess);
    loginProcess = null;
  }
}

/** Close the login browser and immediately start the proxy server. */
export async function completeLogin(
  onData: (s: string) => void,
): Promise<void> {
  if (loginProcess && !loginProcess.killed) {
    killGroup(loginProcess);
    loginProcess = null;
  }
  await startDeepsProxy(onData);
}
