// media-protocol.ts — Custom `hermes-media://` Electron protocol.
//
// Souza/JS local fix (see ~/Documents/hermes-realtime-feedback.md Etapa 12):
// The Hermes Agent backend emits ``MEDIA:/absolute/path`` tags for files it
// wants the UI to render inline.  Messaging adapters (Telegram/Slack/Discord)
// intercept these tags and deliver the file natively, but the api_server SSE
// stream we consume just forwards the raw text.  Renderer-side replacement to
// ``data:`` URIs is impractical (the LLM streams chunks byte-by-byte and CSP
// blocks ``file:`` URLs anyway).
//
// This module registers a custom Electron protocol that serves files from a
// whitelist of trusted directories.  The renderer then rewrites
// ``MEDIA:/path/img.png`` to ``hermes-media:///path/img.png`` inside
// ``AgentMarkdown.tsx`` — react-markdown turns it into ``<img src="...">`` and
// Electron streams the bytes back through this handler.
//
// Security guardrails:
//   * Only paths under WHITELISTED_PREFIXES are served.
//   * Symlinks are not followed: ``fs.realpathSync`` must resolve to a path
//     that still falls under the whitelist.
//   * Range requests aren't supported (Hermes media is small).
//   * The handler is read-only — no writes, no directory listing.

import { protocol } from "electron";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  realpathSync,
} from "fs";
import { homedir, tmpdir } from "os";
import { dirname, join, resolve, sep, extname } from "path";

// Log file lives outside the app bundle so the user can inspect it without
// re-running the app from a terminal. Append-only.
const LOG_FILE = join(homedir(), ".hermes", "logs", "hermes-media.log");

function logLine(line: string): void {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    // never break the handler because of logging
  }
}

export const HERMES_MEDIA_SCHEME = "hermes-media";

/**
 * Privileged-scheme registration entry.  ``app.whenReady`` is too late for
 * this — call from the top level of the main process before ``app.whenReady``
 * resolves.
 *
 * Souza/JS improvement #3: corsEnabled true so XHR/fetch from the renderer
 * doesn't trip cross-origin rejections under stricter CSPs / Chromium
 * versions. The handler still gates everything by whitelist.
 */
export const HERMES_MEDIA_PRIVILEGES = {
  scheme: HERMES_MEDIA_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    bypassCSP: false,
    stream: false,
  },
} as const;

/**
 * Directories whose contents the protocol is allowed to serve.  We resolve to
 * real (symlink-free) absolute paths once at startup so the per-request check
 * is just a string-prefix compare.
 */
function computeWhitelist(): readonly string[] {
  const home = homedir();
  const candidates = [
    join(home, ".hermes"),
    join(home, "Library", "Application Support", "hermes-desktop"),
    tmpdir(),
    "/tmp",
    "/private/tmp",
    "/var/folders",
    "/private/var/folders",
  ];
  const real: string[] = [];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        // realpath collapses symlinks (e.g. /tmp -> /private/tmp on macOS)
        real.push(realpathSync(candidate));
      }
    } catch {
      // ignore — non-existent or unreadable directories simply aren't served
    }
  }
  // Append trailing separator so prefix checks reject "/private/tmpfoo"
  return real.map((p) => (p.endsWith(sep) ? p : p + sep));
}

const WHITELISTED_PREFIXES: readonly string[] = computeWhitelist();

/** True when `realPath` lies under one of the whitelisted directories. */
function isAllowed(realPath: string): boolean {
  const withSep = realPath.endsWith(sep) ? realPath : realPath + sep;
  return WHITELISTED_PREFIXES.some(
    (prefix) =>
      withSep === prefix ||
      withSep.startsWith(prefix) ||
      realPath + sep === prefix,
  );
}

/**
 * Souza/JS improvement #1: single normalization point.
 *
 * Accepts every form the LLM or other code might hand us:
 *   - `MEDIA:/abs/path`
 *   - `hermes-media:///abs/path`
 *   - `hermes-media://abs/path`
 *   - `hermes-media://host/abs/path` (host ignored)
 *   - `file:///abs/path`
 *   - `/abs/path`
 * Returns `null` for anything not resolvable to an absolute filesystem path.
 */
export function normalizeMediaInput(input: string | undefined | null): string | null {
  if (!input || typeof input !== "string") return null;
  let s = input.trim();
  if (!s) return null;

  // Strip optional MEDIA: prefix (backend marker, not a URL scheme)
  if (s.startsWith("MEDIA:")) s = s.slice("MEDIA:".length);

  // Hermes-media protocol
  if (s.startsWith("hermes-media://")) s = s.slice("hermes-media://".length);
  else if (s.startsWith("hermes-media:")) s = s.slice("hermes-media:".length);

  // file:// — drop authority and accept the rest
  if (s.startsWith("file://")) {
    try {
      const u = new URL(s);
      s = u.pathname || s.slice("file://".length);
    } catch {
      s = s.slice("file://".length);
    }
  }

  // Some forms include a leading "host/" (e.g. "hermes-media://abs/path")
  // where the first segment is actually the start of the path. If the
  // result still doesn't start with "/", but contains one, prepend "/".
  s = decodeURIComponent(s);
  if (!s.startsWith("/")) {
    if (s.includes("/")) s = "/" + s;
    else return null;
  }
  return resolve(s);
}

/**
 * Translate a `hermes-media://` URL into an absolute filesystem path.
 * Kept as a wrapper for the protocol handler — delegates to
 * normalizeMediaInput so the two code paths can't drift.
 */
function urlToPath(url: URL): string {
  // Reconstruct the user-facing form and let the normalizer handle it.
  const reassembled = `hermes-media://${url.host || ""}${url.pathname || ""}`;
  return normalizeMediaInput(reassembled) || "";
}

/**
 * Best-effort content-type guess based on file extension.
 * Electron's `Response` doesn't auto-detect — we have to set it explicitly
 * for the renderer's `<img>` to render the bytes as the right format.
 */
const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".heic": "image/heic",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

export function mimeFor(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] || "application/octet-stream";
}

/**
 * Used by the IPC fallback (`read-media-as-data-uri`) so the renderer can
 * load images even when the custom protocol fails for whatever reason
 * (privilege misconfig, CSP weirdness, Electron version regression).
 *
 * Same whitelist + zero-byte rejection as the protocol handler.
 * Returns `null` on any rejection so the renderer can decide what to show.
 */
export function readMediaAsDataUri(rawPath: string): {
  uri?: string;
  error?: string;
  mime?: string;
  size?: number;
} {
  const absolute = normalizeMediaInput(rawPath);
  if (!absolute) {
    return { error: `Path inválido ou não absoluto: ${rawPath}` };
  }
  let realPath: string;
  try {
    realPath = realpathSync(absolute);
  } catch (err) {
    logLine(`[ipc] not found: ${absolute} (${err})`);
    return { error: `Not found: ${absolute}` };
  }
  if (!isAllowed(realPath)) {
    logLine(`[ipc] outside whitelist: ${realPath}`);
    return { error: `Path outside allowed whitelist` };
  }
  let stat;
  try {
    stat = statSync(realPath);
  } catch (err) {
    return { error: `Stat failed: ${err}` };
  }
  if (!stat.isFile()) return { error: "Not a regular file" };
  if (stat.size <= 0) return { error: "Empty file (0 bytes)" };
  // Generous-but-not-unlimited cap so a giant file doesn't OOM the renderer.
  if (stat.size > 32 * 1024 * 1024) {
    return { error: `File too large (${stat.size} bytes; max 32MB)` };
  }
  try {
    const bytes = readFileSync(realPath);
    const mime = mimeFor(realPath);
    const b64 = bytes.toString("base64");
    logLine(`[ipc] served ${realPath} as data: (${bytes.length}B ${mime})`);
    return {
      uri: `data:${mime};base64,${b64}`,
      mime,
      size: bytes.length,
    };
  } catch (err) {
    return { error: `Read failed: ${err}` };
  }
}

// Souza/JS improvement #2: prevent double registration when the dev server
// reloads the main process (electron-vite HMR) or when the function is
// called twice by accident. Electron's `protocol.handle` would throw
// "ProtocolHandlerExists" and crash boot.
let _protocolRegistered = false;

/**
 * Souza/JS improvement #5: machine-parseable error body so the renderer's
 * IPC fallback can surface useful diagnostics without re-implementing
 * status-code mapping.
 */
function errorResponse(
  status: number,
  code: string,
  message: string,
  path?: string,
): Response {
  return new Response(
    JSON.stringify({ ok: false, status, code, message, path }),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Hermes-Media-Error": code,
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

/**
 * Register the `hermes-media://` protocol handler. Must be called after
 * ``app.whenReady()`` resolves. Idempotent: safe to call multiple times.
 */
export function registerHermesMediaProtocol(): void {
  if (_protocolRegistered) {
    logLine(`protocol register skipped (already registered)`);
    return;
  }

  protocol.handle(HERMES_MEDIA_SCHEME, async (request) => {
    const logTag = `[protocol]`;

    let parsed: URL;
    try {
      parsed = new URL(request.url);
    } catch {
      logLine(`${logTag} bad URL: ${request.url}`);
      return errorResponse(400, "BAD_URL", "Malformed hermes-media URL");
    }

    const absolute = urlToPath(parsed);
    if (!absolute || !absolute.startsWith("/")) {
      logLine(`${logTag} non-absolute path rejected: ${absolute}`);
      return errorResponse(
        403,
        "RELATIVE_PATH",
        "URL não resolveu para path absoluto",
        absolute,
      );
    }

    let realPath: string;
    try {
      realPath = realpathSync(absolute);
    } catch (err) {
      logLine(`${logTag} not found: ${absolute} (${err})`);
      return errorResponse(
        404,
        "NOT_FOUND",
        `Arquivo não encontrado: ${absolute}`,
        absolute,
      );
    }

    if (!isAllowed(realPath)) {
      logLine(
        `${logTag} outside whitelist: ${realPath} (allowed: ${WHITELISTED_PREFIXES.join(", ")})`,
      );
      return errorResponse(
        403,
        "OUTSIDE_WHITELIST",
        `Path fora dos diretórios permitidos. Permitidos: ${WHITELISTED_PREFIXES.join(", ")}`,
        realPath,
      );
    }

    let stat;
    try {
      stat = statSync(realPath);
    } catch (err) {
      logLine(`${logTag} stat failed: ${realPath} (${err})`);
      return errorResponse(404, "STAT_FAILED", String(err), realPath);
    }
    if (!stat.isFile()) {
      logLine(`${logTag} not a regular file: ${realPath}`);
      return errorResponse(
        403,
        "NOT_REGULAR_FILE",
        "Não é arquivo regular",
        realPath,
      );
    }
    if (stat.size <= 0) {
      logLine(`${logTag} empty artifact: ${realPath}`);
      return errorResponse(
        422,
        "EMPTY",
        "Arquivo vazio (0 bytes) — provavelmente capturado mid-write",
        realPath,
      );
    }

    try {
      const buf = readFileSync(realPath);
      // Souza/JS improvement #4: use Uint8Array (Web standard) rather than
      // a Node Buffer when constructing the Response. Some Electron/Node
      // version combos misinterpret Buffer here (renders as empty/garbage
      // depending on the underlying ArrayBuffer slice). Uint8Array is the
      // Fetch API's expected BodyInit type.
      const bytes = new Uint8Array(
        buf.buffer,
        buf.byteOffset,
        buf.byteLength,
      );
      const mime = mimeFor(realPath);
      logLine(`${logTag} served ${realPath} (${bytes.length}B ${mime})`);
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Content-Length": String(bytes.length),
          "Cache-Control": "private, max-age=600",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Referrer-Policy": "no-referrer",
          "X-Hermes-Media-Source": "protocol",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (err) {
      logLine(`${logTag} read failed: ${realPath} (${err})`);
      return errorResponse(500, "READ_ERROR", String(err), realPath);
    }
  });

  _protocolRegistered = true;
  logLine(
    `protocol registered. Whitelist (${WHITELISTED_PREFIXES.length}):\n` +
      WHITELISTED_PREFIXES.map((w) => `  - ${w}`).join("\n"),
  );
}
