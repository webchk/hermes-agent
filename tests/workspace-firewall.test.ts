import { describe, it, expect } from "vitest";
import { WorkspaceContextFirewall } from "../src/main/workspace-firewall";

describe("WorkspaceContextFirewall", () => {
  it("allows access when resource belongs to active workspace", () => {
    const firewall = new WorkspaceContextFirewall("workspace_a");
    expect(firewall.canAccess("workspace_a")).toBe(true);
  });

  it("blocks access when resource belongs to different workspace", () => {
    const firewall = new WorkspaceContextFirewall("workspace_a");
    expect(firewall.canAccess("workspace_b")).toBe(false);
  });

  it("allows access to global resources (no workspace)", () => {
    const firewall = new WorkspaceContextFirewall("workspace_a");
    expect(firewall.canAccess(undefined)).toBe(true);
    expect(firewall.canAccess(null)).toBe(true);
  });

  it("validates access and returns violation detail", () => {
    const firewall = new WorkspaceContextFirewall("active_ws");
    const result = firewall.validate("other_ws", "memory", "read");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("other_ws");
  });

  it("allows access to own workspace resources", () => {
    const firewall = new WorkspaceContextFirewall("active_ws");
    const result = firewall.validate("active_ws", "session", "read");
    expect(result.allowed).toBe(true);
  });
});
