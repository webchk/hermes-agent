import { useState, useEffect, useCallback, memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, X as CloseIcon } from "lucide-react";
import { useI18n } from "./useI18n";

// ────────────────────────────────────────────────────────────────────────────
// MEDIA:/path → hermes-media:///path (Souza/JS, see media-protocol.ts).
//
// The backend emits ``MEDIA:/absolute/path`` tags for files it wants the UI
// to render inline.  We rewrite to the privileged ``hermes-media://`` protocol
// (registered in main process) so react-markdown turns it into an ``<img>``
// served by the local file handler.  Only image extensions become inline
// images; videos/audio surface as labeled paths so they don't disappear.
// ────────────────────────────────────────────────────────────────────────────

const MEDIA_RE = /MEDIA:([^\s`)\]\}>'"]+)/g;
const INLINE_IMAGE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".ico",
]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"]);

function extOf(path: string): string {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i).toLowerCase() : "";
}

function nameOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function rewriteMediaTags(text: string): string {
  if (!text || !text.includes("MEDIA:")) return text;
  return text.replace(MEDIA_RE, (full, rawPath: string) => {
    const cleanPath = rawPath.replace(/[,;.]$/, "");
    if (!cleanPath.startsWith("/")) return full;
    const ext = extOf(cleanPath);
    const filename = nameOf(cleanPath);
    if (INLINE_IMAGE_EXTS.has(ext)) {
      // hermes-media:// — handled by main process protocol handler
      return `![${filename}](hermes-media://${encodeURI(cleanPath)})`;
    }
    if (VIDEO_EXTS.has(ext)) {
      return `🎬 \`${cleanPath}\``;
    }
    if (AUDIO_EXTS.has(ext)) {
      return `🔊 \`${cleanPath}\``;
    }
    return full;
  });
}

// Lazy-load the heavy syntax highlighter — only imported when a code block renders
let _highlighterMod: typeof import("react-syntax-highlighter") | null = null;
let _oneDark: Record<string, React.CSSProperties> | null = null;
let _loadingPromise: Promise<void> | null = null;

function loadHighlighter(): Promise<void> {
  if (_highlighterMod && _oneDark) return Promise.resolve();
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = Promise.all([
    import("react-syntax-highlighter"),
    import("react-syntax-highlighter/dist/esm/styles/prism/one-dark"),
  ]).then(([mod, style]) => {
    _highlighterMod = mod;
    _oneDark = style.default;
  });
  return _loadingPromise;
}

// Diff viewer with colored +/- lines
function DiffView({ code }: { code: string }): React.JSX.Element {
  const lines = code.split("\n");
  return (
    <div className="chat-diff-content">
      {lines.map((line, i) => {
        let cls = "chat-diff-line";
        if (line.startsWith("+")) cls += " chat-diff-add";
        else if (line.startsWith("-")) cls += " chat-diff-remove";
        else if (line.startsWith("@@")) cls += " chat-diff-hunk";
        return (
          <div key={i} className={cls}>
            {line || "\u00A0"}
          </div>
        );
      })}
    </div>
  );
}

// Code block with syntax highlighting and copy button (lazy-loaded highlighter)
function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [highlighterReady, setHighlighterReady] = useState(
    () => _highlighterMod !== null && _oneDark !== null,
  );
  const code = String(children).replace(/\n$/, "");
  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "";
  const isDiff = language === "diff";

  // Trigger lazy load when code block mounts
  useEffect(() => {
    if (!highlighterReady) {
      loadHighlighter().then(() => setHighlighterReady(true));
    }
  }, [highlighterReady]);

  function handleCopy(): void {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const fallbackPre = (
    <pre
      style={{
        margin: 0,
        borderRadius: 0,
        fontSize: "13px",
        padding: "12px",
        background: "transparent",
        color: "#abb2bf",
        overflow: "auto",
      }}
    >
      {code}
    </pre>
  );

  return (
    <div className="chat-code-block">
      <div className="chat-code-header">
        <span className="chat-code-lang">
          {isDiff ? "diff" : language || "code"}
        </span>
        <button className="chat-code-copy" onClick={handleCopy}>
          {copied ? t("common.copied") : <Copy size={13} />}
        </button>
      </div>
      {isDiff ? (
        <DiffView code={code} />
      ) : highlighterReady && _highlighterMod && _oneDark ? (
        <_highlighterMod.Prism
          style={_oneDark}
          language={language || "text"}
          PreTag="div"
          customStyle={{
            margin: 0,
            borderRadius: 0,
            fontSize: "13px",
            padding: "12px",
            background: "transparent",
          }}
        >
          {code}
        </_highlighterMod.Prism>
      ) : (
        fallbackPre
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Inline image with lightbox (click to expand). Used by AgentMarkdown's `img`
// component override so any image — whether it came from a `data:` URI or
// from our `hermes-media://` protocol — can be expanded to fullscreen view
// without bouncing through OS file viewers.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract a filesystem path from any src form we accept:
 *   - hermes-media:///abs/path
 *   - hermes-media://abs/path
 *   - /abs/path  (already a raw absolute path)
 * Returns null when src isn't something we can resolve via IPC.
 */
function srcToAbsolutePath(src: string): string | null {
  if (src.startsWith("hermes-media://")) {
    return decodeURI(src.replace(/^hermes-media:\/\//, ""));
  }
  if (src.startsWith("/")) return decodeURI(src);
  return null;
}

const InlineImage = memo(function InlineImage({
  src,
  alt,
}: {
  src?: string;
  alt?: string;
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const [effectiveSrc, setEffectiveSrc] = useState<string | undefined>(src);
  const [fallbackTried, setFallbackTried] = useState(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const close = useCallback(() => setExpanded(false), []);

  // Reset whenever the source changes (new message render)
  useEffect(() => {
    setEffectiveSrc(src);
    setFallbackTried(false);
    setFallbackError(null);
  }, [src]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, close]);

  // Fallback strategy: when the primary <img> errors, fetch the bytes via
  // IPC and switch to a data: URI. Sidesteps any quirk in the custom
  // hermes-media:// protocol (CSP, privilege flags, Electron version).
  const handlePrimaryError = useCallback(async () => {
    if (fallbackTried) {
      setFallbackError("Falha ao carregar imagem (fallback IPC já tentado)");
      return;
    }
    setFallbackTried(true);

    if (!src) {
      setFallbackError("src vazio");
      return;
    }
    const absolute = srcToAbsolutePath(src);
    if (!absolute) {
      setFallbackError(`src não resolvível: ${src}`);
      return;
    }
    try {
      const result = await window.hermesAPI.readMediaAsDataUri(absolute);
      if (result.uri) {
        setEffectiveSrc(result.uri);
        return;
      }
      setFallbackError(result.error || "IPC retornou sem URI");
    } catch (err) {
      setFallbackError(
        `IPC erro: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [fallbackTried, src]);

  if (!src) return null;

  if (fallbackError) {
    const absolute = srcToAbsolutePath(src) || src;
    return (
      <div className="chat-inline-image-error">
        <div>⚠️ Falha ao carregar imagem</div>
        <code>{absolute}</code>
        <div className="chat-inline-image-error-reason">{fallbackError}</div>
        <div className="chat-inline-image-error-actions">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              window.hermesAPI.openExternal(`file://${absolute}`);
            }}
          >
            Abrir no app padrão do macOS
          </a>
          <span> · </span>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setFallbackTried(false);
              setFallbackError(null);
              setEffectiveSrc(src);
            }}
          >
            Tentar de novo
          </a>
        </div>
      </div>
    );
  }

  return (
    <>
      <img
        src={effectiveSrc}
        alt={alt || ""}
        className="chat-inline-image"
        loading="lazy"
        onClick={() => setExpanded(true)}
        onError={() => {
          void handlePrimaryError();
        }}
        title={alt || "Click to expand"}
      />
      {expanded && (
        <div
          className="chat-image-lightbox"
          onClick={close}
          role="dialog"
          aria-modal="true"
        >
          <button
            className="chat-image-lightbox-close"
            aria-label="Close"
            onClick={(e) => {
              e.stopPropagation();
              close();
            }}
          >
            <CloseIcon size={20} />
          </button>
          <img
            src={effectiveSrc}
            alt={alt || ""}
            className="chat-image-lightbox-img"
          />
        </div>
      )}
    </>
  );
});

// Shared Markdown renderer that opens links externally
const AgentMarkdown = memo(function AgentMarkdown({
  children,
}: {
  children: string;
}): React.JSX.Element {
  // Pre-process: rewrite MEDIA:/path tags into hermes-media:// markdown images
  const rewritten = rewriteMediaTags(children);

  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      // Pass URLs through unchanged. CSP (img-src 'self' data: hermes-media:;
      // connect-src 'self' hermes-media:) is the actual security boundary —
      // it blocks javascript:/file: at the browser level. Returning undefined
      // here just dropped legitimate hermes-media: URLs silently.
      urlTransform={(value) => value}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              if (!href) return;
              try {
                const url = new URL(href, "https://placeholder.invalid");
                if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
                  return;
                }
              } catch {
                return;
              }
              window.hermesAPI.openExternal(href);
            }}
          >
            {children}
          </a>
        ),
        img: ({ src, alt }) => (
          <InlineImage src={typeof src === "string" ? src : undefined} alt={alt} />
        ),
        code: ({ className, children, ...props }) => {
          const isInline =
            !className &&
            typeof children === "string" &&
            !children.includes("\n");
          if (isInline) {
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }
          return <CodeBlock className={className}>{children}</CodeBlock>;
        },
      }}
    >
      {rewritten}
    </Markdown>
  );
});

export { AgentMarkdown };
export default AgentMarkdown;
