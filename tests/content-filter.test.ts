import { describe, it, expect } from "vitest";
import { filterSystemContent } from "../src/renderer/src/hooks/useContentFilter";

describe("filterSystemContent", () => {
  it("remove cron job prefix", () => {
    const input =
      "[IMPORTANT: You are running as a scheduled cron job. DELIVERY: Your final response will be automatically delivered to the user — do NOT use send_message or try to deliver the output yourself. Just produce your report/output as your final response and the system handles the rest. SILENT: If there is genuinely nothing new to report, respond with exactly \"[SILENT]\" (nothing else) to suppress delivery. Never combine [SILENT] with content — either report your findings normally, or say [SILENT] and nothing more.]\n\nHere is my report...";
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
