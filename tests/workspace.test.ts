import { describe, it, expect } from "vitest";
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
