/**
 * agent-browser bootstrap — Souza/JS
 *
 * On every app start, ensures the bundled agent-browser binary
 * (vercel-labs/agent-browser) is available at ~/.hermes/bin/agent-browser so
 * the Hermes Agent plugin `agent-browser` can find it without forcing the
 * user to install via npm/cargo/brew.
 *
 * Strategy:
 *   1. Locate the bundled binary for the current arch inside the .app
 *      (resources/agent-browser-bin/agent-browser-darwin-arm64 or -x64).
 *   2. Compute a content-hash of the bundled binary.
 *   3. If the installed copy is missing OR different from the bundled one
 *      (version mismatch), copy bundled → ~/.hermes/bin/agent-browser and
 *      chmod +x.
 *   4. Write the resolved path to ~/.hermes/agent-browser-path.txt for the
 *      Python plugin's hot-path lookup.
 *
 * Idempotent: safe to run every launch. Cheap when nothing changed (mtime+size
 * compare before hashing).
 */
import { app, ipcMain } from "electron";
import { existsSync, mkdirSync, copyFileSync, statSync, chmodSync, writeFileSync, readFileSync } from "fs";
import { createHash } from "crypto";
import { homedir, arch } from "os";
import { join, dirname } from "path";

const HERMES_HOME = join(homedir(), ".hermes");
const HERMES_BIN_DIR = join(HERMES_HOME, "bin");
const INSTALLED_BIN = join(HERMES_BIN_DIR, "agent-browser");
const PATH_FILE = join(HERMES_HOME, "agent-browser-path.txt");
const LOG_FILE = join(HERMES_HOME, "logs", "agent-browser-bootstrap.log");

function log(msg: string): void {
  try {
    const dir = dirname(LOG_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("fs").appendFileSync(LOG_FILE, line, "utf-8");
  } catch {
    /* never crash on log */
  }
}

function bundledBinaryPath(): string | null {
  const platform = process.platform;
  if (platform !== "darwin" && platform !== "linux" && platform !== "win32") {
    return null;
  }
  // platform/arch suffix matches the upstream npm package convention.
  let suffix: string;
  if (platform === "darwin") {
    suffix = arch() === "arm64" ? "darwin-arm64" : "darwin-x64";
  } else if (platform === "linux") {
    suffix = arch() === "arm64" ? "linux-arm64" : "linux-x64";
  } else {
    suffix = "win32-x64.exe";
  }
  // electron-builder.yml has `asarUnpack: - resources/**`, so the resources/
  // folder lands under <Resources>/app.asar.unpacked/resources/ at runtime.
  // We check both paths to be resilient to layout changes.
  const candidates = [
    join(
      process.resourcesPath || "",
      "app.asar.unpacked",
      "resources",
      "agent-browser-bin",
      `agent-browser-${suffix}`,
    ),
    join(process.resourcesPath || "", "agent-browser-bin", `agent-browser-${suffix}`),
    // dev fallback: relative to the source tree
    join(__dirname, "..", "..", "resources", "agent-browser-bin", `agent-browser-${suffix}`),
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

function hashFile(path: string): string | null {
  try {
    const buf = readFileSync(path);
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}

function quickEqualBySize(a: string, b: string): boolean {
  try {
    return statSync(a).size === statSync(b).size;
  } catch {
    return false;
  }
}

function ensureInstalled(): { installedPath: string | null; action: string } {
  const bundled = bundledBinaryPath();
  if (!bundled) {
    return { installedPath: null, action: "no-bundled-binary" };
  }
  // Make sure target dir exists
  if (!existsSync(HERMES_BIN_DIR)) {
    mkdirSync(HERMES_BIN_DIR, { recursive: true });
  }
  let needsCopy = !existsSync(INSTALLED_BIN);
  // Fast path: if sizes differ, copy. If same, do an SHA-256 hash compare.
  if (!needsCopy && !quickEqualBySize(bundled, INSTALLED_BIN)) {
    needsCopy = true;
  } else if (!needsCopy) {
    const h1 = hashFile(bundled);
    const h2 = hashFile(INSTALLED_BIN);
    needsCopy = !h1 || !h2 || h1 !== h2;
  }
  if (needsCopy) {
    try {
      copyFileSync(bundled, INSTALLED_BIN);
      chmodSync(INSTALLED_BIN, 0o755);
      return { installedPath: INSTALLED_BIN, action: "copied" };
    } catch (err) {
      log(`copyFileSync failed: ${(err as Error).message}`);
      return { installedPath: null, action: "copy-failed" };
    }
  }
  return { installedPath: INSTALLED_BIN, action: "already-current" };
}

export function bootstrapAgentBrowser(): { installedPath: string | null; action: string } {
  try {
    const result = ensureInstalled();
    // Always update the path file so the Python plugin sees the current state.
    try {
      writeFileSync(PATH_FILE, (result.installedPath || "") + "\n", "utf-8");
    } catch (err) {
      log(`PATH_FILE write failed: ${(err as Error).message}`);
    }
    log(`bootstrap action=${result.action} path=${result.installedPath || "(none)"}`);
    return result;
  } catch (err) {
    log(`bootstrap exception: ${(err as Error).message}`);
    return { installedPath: null, action: "exception" };
  }
}

/** IPC handlers — let the renderer (Settings → Agent Browser panel) query
 * status and force a reinstall. */
export function registerAgentBrowserIpc(): void {
  ipcMain.handle("agent-browser:status", () => {
    const installed = existsSync(INSTALLED_BIN);
    const bundled = bundledBinaryPath();
    return {
      installed,
      installedPath: installed ? INSTALLED_BIN : null,
      bundled: bundled !== null,
      bundledPath: bundled,
      pathFile: PATH_FILE,
      hermesHome: HERMES_HOME,
    };
  });
  ipcMain.handle("agent-browser:reinstall", () => bootstrapAgentBrowser());
}

// Auto-run on import — guarantees the binary exists by the time IPC handlers fire.
// Wrapped so a failure doesn't block app startup.
try {
  if (app && (app.isReady ? !app.isReady() : true)) {
    // Defer to whenReady so process.resourcesPath is populated.
    app.whenReady().then(() => {
      bootstrapAgentBrowser();
    });
  } else {
    bootstrapAgentBrowser();
  }
} catch {
  /* electron not ready / test env */
}
