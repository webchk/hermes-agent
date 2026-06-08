import { join } from "path";
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
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
  // Build an augmented PATH covering Homebrew (macOS), common Linux prefixes,
  // and NVM's default install location so the Electron process — which may
  // launch without the user's shell profile — can locate node/npm/npx/git.
  const home = homedir();
  const nvmBin = ((): string => {
    const nvmDir = process.env.NVM_DIR || join(home, ".nvm");
    try {
      // ~/.nvm/alias/default is a symlink/file containing the active version
      const alias = join(nvmDir, "alias", "default");
      if (existsSync(alias)) {
        const ver = execSync(`cat "${alias}"`, { timeout: 2000 })
          .toString()
          .trim()
          .replace(/^v/, "");
        const bin = join(nvmDir, "versions", "node", `v${ver}`, "bin");
        if (existsSync(bin)) return bin;
      }
      // Fallback: pick the highest version directory available
      const versionsDir = join(nvmDir, "versions", "node");
      if (existsSync(versionsDir)) {
        const versions = readdirSync(versionsDir).sort().reverse();
        if (versions.length) {
          return join(versionsDir, versions[0], "bin");
        }
      }
    } catch { /* nvm not installed */ }
    return "";
  })();

  const extra = [
    nvmBin,
    join(home, ".fnm", "aliases", "default", "bin"),   // fnm
    join(home, ".volta", "bin"),                        // Volta
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].filter(Boolean).join(":");

  return {
    ...process.env,
    PATH: `${extra}:${process.env.PATH || ""}`,
  };
}

// Locate an executable robustly: static candidates first, then `which` as
// a fallback so NVM / fnm / Volta installs are found even on clean PATH.
function findExec(name: string): string {
  const home = homedir();
  const nvmDir = process.env.NVM_DIR || join(home, ".nvm");

  const candidates: string[] = [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    join(home, ".volta", "bin", name),
    join(home, ".fnm", "aliases", "default", "bin", name),
  ];

  // NVM: add all installed versions, newest first
  try {
    const versionsDir = join(nvmDir, "versions", "node");
    if (existsSync(versionsDir)) {
      const vers = readdirSync(versionsDir).sort().reverse().slice(0, 5);
      for (const v of vers) {
        candidates.push(join(versionsDir, v, "bin", name));
      }
    }
  } catch { /* nvm not present */ }

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  // Last resort: shell `which`
  try {
    const found = execSync(`which ${name}`, {
      env: buildEnv(),
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (found && existsSync(found)) return found;
  } catch { /* which failed */ }

  return name;
}

// Spawn a command and stream output. Optional timeoutMs aborts the process
// if it runs longer than expected (guards against hung npm installs).
function spawnCmd(
  cmd: string,
  args: string[],
  cwd: string | undefined,
  onData: (s: string) => void,
  timeoutMs?: number,
): Promise<number> {
  return new Promise((resolve) => {
    const env = buildEnv();
    const p = spawn(cmd, args, { cwd, env, shell: false });
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (timeoutMs) {
      timer = setTimeout(() => {
        onData(`[erro] ${cmd}: tempo limite excedido (${timeoutMs / 1000}s)\n`);
        try { p.kill("SIGTERM"); } catch { /* already dead */ }
        resolve(1);
      }, timeoutMs);
    }
    p.stdout?.on("data", (d: Buffer) => onData(d.toString()));
    p.stderr?.on("data", (d: Buffer) => onData(d.toString()));
    p.on("error", (err) => {
      if (timer) clearTimeout(timer);
      onData(`[erro] ${cmd}: ${err.message}\n`);
      resolve(1);
    });
    p.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve(code ?? 1);
    });
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

// npm install flags that improve reliability on slow/proxied networks:
// - increased socket timeout and retries handled by npm itself
// - --no-audit / --no-fund skip network calls that aren't needed for install
// - --legacy-peer-deps avoids peer-dep resolution that can stall on bad networks
const NPM_INSTALL_FLAGS = [
  "install",
  "--prefer-offline",
  "--legacy-peer-deps",
  "--no-audit",
  "--no-fund",
  "--fetch-timeout=300000",      // 5 min socket read timeout
  "--fetch-retry-mintimeout=10000",
  "--fetch-retry-maxtimeout=60000",
  "--fetch-retries=3",
];

// Total wall-clock limit per npm attempt: 10 minutes.
const NPM_TIMEOUT_MS = 10 * 60 * 1000;

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
    await spawnCmd(git, ["-C", DEEPSPROXY_DIR, "pull"], undefined, onData, 60_000);
  } else {
    onData("[deepsproxy] Clonando repositório…\n");
    const code = await spawnCmd(
      git,
      ["clone", "--depth", "1", DEEPSPROXY_REPO, DEEPSPROXY_DIR],
      undefined,
      onData,
      120_000,
    );
    if (code !== 0) {
      onData("[deepsproxy] Falha no git clone. Verifique conexão e Git instalado.\n");
      return;
    }
  }

  const npm = findExec("npm");
  onData(`[deepsproxy] Usando npm: ${npm}\n`);

  // Two attempts — first with --prefer-offline (fast when cache is warm),
  // second without it if the cache was cold and we still timed out.
  let npmCode = await (async (): Promise<number> => {
    onData("[deepsproxy] Instalando dependências (tentativa 1/2)…\n");
    const code = await spawnCmd(npm, NPM_INSTALL_FLAGS, DEEPSPROXY_DIR, onData, NPM_TIMEOUT_MS);
    if (code === 0) return 0;

    onData("[deepsproxy] Tentativa 1 falhou. Aguardando 5s e tentando novamente…\n");
    await new Promise<void>((r) => setTimeout(r, 5000));

    onData("[deepsproxy] Instalando dependências (tentativa 2/2)…\n");
    // Remove --prefer-offline on retry so npm fetches from registry unconditionally.
    const retryFlags = NPM_INSTALL_FLAGS.filter((f) => f !== "--prefer-offline");
    return spawnCmd(npm, retryFlags, DEEPSPROXY_DIR, onData, NPM_TIMEOUT_MS);
  })();

  if (npmCode !== 0) {
    onData(
      "[deepsproxy] Falha no npm install após 2 tentativas.\n" +
        "  → Verifique se o Node.js (≥18) está instalado: node --version\n" +
        "  → Se estiver atrás de proxy, configure: npm config set proxy http://SEU_PROXY\n" +
        "  → Tente manualmente: cd ~/.hermes/deepsproxy && npm install\n",
    );
    return;
  }

  onData("[deepsproxy] Instalando Chromium (playwright)…\n");
  const npx = findExec("npx");
  await spawnCmd(
    npx,
    ["playwright", "install", "chromium", "--with-deps"],
    DEEPSPROXY_DIR,
    onData,
    20 * 60_000, // 20 min — Chromium download can be slow
  );
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

let headlessPreference = true;

export function setHeadlessPreference(h: boolean): void {
  headlessPreference = h;
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
    env: { ...buildEnv(), PORT: String(port), DEEPSPROXY_HEADLESS: String(headlessPreference) },
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

/** Close the login browser and start the proxy server once cookies are flushed. */
export async function completeLogin(
  onData: (s: string) => void,
): Promise<void> {
  if (loginProcess && !loginProcess.killed) {
    // Register the close listener BEFORE sending the signal so we don't miss it
    const exitPromise = new Promise<void>((resolve) => {
      loginProcess!.once("close", () => resolve());
    });
    // SIGTERM → login.ts handler calls closePlaywright() → Chromium flushes cookies
    killGroup(loginProcess);
    // Wait up to 5s for the login process to finish flushing
    await Promise.race([
      exitPromise,
      new Promise<void>((r) => setTimeout(r, 5000)),
    ]);
    loginProcess = null;
  }
  // Give the filesystem an extra moment to complete profile writes
  await new Promise<void>((r) => setTimeout(r, 1500));
  await startDeepsProxy(onData);
}
