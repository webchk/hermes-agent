/**
 * Extracted SSE parsing logic — testable without Electron or HTTP.
 */

export interface ParsedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
  rateLimitRemaining?: number;
  rateLimitReset?: number;
}

/**
 * Structured tool lifecycle event delivered by `hermes.tool.progress` SSE
 * events from the api_server gateway. Status transitions: `running` (tool
 * starts executing) → `completed` (success) | `error` (failure).
 * Souza/JS: surfaced for richer UI feedback (ToolCallCard component).
 */
export interface ToolEvent {
  toolCallId: string;
  tool: string;
  status: "running" | "completed" | "error";
  label?: string;
  emoji?: string;
  args?: unknown;
  result?: string;
  durationMs?: number;
  receivedAt: number;
}

export interface SseCallbacks {
  onChunk: (text: string) => void;
  onToolProgress?: (tool: string) => void;
  /**
   * Structured callback for tool lifecycle events. Receives full payload
   * including toolCallId so the UI can correlate `running` and `completed`
   * events for the same call. When defined, this is invoked in addition to
   * `onToolProgress` (kept for back-compat).
   */
  onToolEvent?: (event: ToolEvent) => void;
  onUsage?: (usage: ParsedUsage) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

/** Tool progress pattern: `emoji tool_name` or `emoji description` */
const toolProgressRe = /^`([^\s`]+)\s+([^`]+)`$/;

/**
 * Process a custom SSE event (e.g. hermes.tool.progress).
 * Returns true if the event was handled.
 */
export function processCustomEvent(
  eventType: string,
  data: string,
  cb: Pick<SseCallbacks, "onToolProgress" | "onToolEvent">,
): boolean {
  if (eventType === "hermes.tool.progress") {
    try {
      const payload = JSON.parse(data);
      const label = payload.label || payload.tool || "";
      const emoji = payload.emoji || "";
      // Back-compat: legacy string callback.
      if (cb.onToolProgress) {
        cb.onToolProgress(emoji ? `${emoji} ${label}` : label);
      }
      // Structured callback for richer UI rendering (ToolCallCard).
      if (cb.onToolEvent) {
        const rawStatus = String(payload.status || "running").toLowerCase();
        const status: ToolEvent["status"] =
          rawStatus === "completed" || rawStatus === "error"
            ? rawStatus
            : "running";
        cb.onToolEvent({
          toolCallId: String(payload.toolCallId || payload.tool_call_id || ""),
          tool: String(payload.tool || ""),
          status,
          label: typeof label === "string" ? label : String(label),
          emoji: typeof emoji === "string" ? emoji : undefined,
          args: payload.arguments ?? payload.args,
          result: payload.result,
          durationMs:
            typeof payload.durationMs === "number"
              ? payload.durationMs
              : typeof payload.duration_ms === "number"
                ? payload.duration_ms
                : undefined,
          receivedAt: Date.now(),
        });
      }
      return true;
    } catch {
      /* malformed — skip */
    }
  }
  return false;
}

export interface SseDataResult {
  done: boolean;
  hasContent: boolean;
  error?: string;
}

/**
 * Process a single SSE data payload (after `data: ` prefix is stripped).
 * Returns parsing result.
 */
export function processSseData(
  data: string,
  cb: SseCallbacks,
  state: { hasContent: boolean; lastError: string },
): SseDataResult {
  if (data === "[DONE]") {
    if (state.hasContent) {
      cb.onDone?.();
    }
    return { done: true, hasContent: state.hasContent, error: state.lastError };
  }

  try {
    const parsed = JSON.parse(data);

    // Capture error responses forwarded through SSE
    if (parsed.error) {
      state.lastError = parsed.error.message || JSON.stringify(parsed.error);
      return { done: false, hasContent: state.hasContent };
    }

    const delta = parsed.choices?.[0]?.delta;

    // Extract usage from final chunk
    if (parsed.usage && cb.onUsage) {
      cb.onUsage({
        promptTokens: parsed.usage.prompt_tokens || 0,
        completionTokens: parsed.usage.completion_tokens || 0,
        totalTokens: parsed.usage.total_tokens || 0,
        cost: parsed.usage.cost,
        rateLimitRemaining: parsed.usage.rate_limit_remaining,
        rateLimitReset: parsed.usage.rate_limit_reset,
      });
    }

    if (delta?.content) {
      const content = delta.content.trim();
      // Legacy: Detect tool progress lines injected into content
      const match = toolProgressRe.exec(content);
      if (match && cb.onToolProgress) {
        cb.onToolProgress(`${match[1]} ${match[2]}`);
      } else {
        state.hasContent = true;
        cb.onChunk(delta.content);
      }
    }
  } catch {
    /* malformed chunk — skip */
  }

  return { done: false, hasContent: state.hasContent };
}

/**
 * Parse a full SSE block (may contain `event:` and `data:` lines).
 * Returns { eventType, data } or null if no data line found.
 */
export function parseSseBlock(
  block: string,
): { eventType: string; data: string } | null {
  let eventType = "";
  let dataLine = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      dataLine = line.slice(6);
    }
  }
  if (!dataLine) return null;
  return { eventType, data: dataLine };
}
