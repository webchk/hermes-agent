import { describe, it, expect } from "vitest";
import { WorkspaceContextFirewall } from "../src/main/workspace-firewall";
import { filterSystemContent } from "../src/renderer/src/hooks/useContentFilter";

describe("Workspace Isolation — 10 requisitos", () => {
  it("req1: firewall bloqueia acesso de workspace_a a recursos de workspace_b", () => {
    const fw = new WorkspaceContextFirewall("workspace_a");
    expect(fw.canAccess("workspace_b")).toBe(false);
  });

  it("req2: firewall bloqueia acesso de workspace_b a recursos de workspace_a", () => {
    const fw = new WorkspaceContextFirewall("workspace_b");
    expect(fw.canAccess("workspace_a")).toBe(false);
  });

  it("req3: validate memory access rejects cross-workspace", () => {
    const fw = new WorkspaceContextFirewall("ws_1");
    const result = fw.validate("ws_2", "memory", "read");
    expect(result.allowed).toBe(false);
  });

  it("req4: sessions do mesmo workspace são permitidas", () => {
    const fw = new WorkspaceContextFirewall("ws_1");
    expect(fw.canAccess("ws_1")).toBe(true);
  });

  it("req5: recursos globais (undefined workspace) sempre permitidos", () => {
    const fw = new WorkspaceContextFirewall("any_workspace");
    expect(fw.canAccess(undefined)).toBe(true);
    expect(fw.canAccess(null)).toBe(true);
  });

  it("req6: cron job de outro workspace é bloqueado", () => {
    const fw = new WorkspaceContextFirewall("project_a");
    const result = fw.validate("project_b", "cron", "read");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("req7: skills de outro workspace são bloqueadas", () => {
    const fw = new WorkspaceContextFirewall("dev_ws");
    expect(fw.canAccess("research_ws")).toBe(false);
  });

  it("req8: assertAccess lança Error em acesso negado", () => {
    const fw = new WorkspaceContextFirewall("ws_a");
    expect(() => fw.assertAccess("ws_b", "session", "write")).toThrow(
      /WorkspaceFirewall/,
    );
  });

  it("req9: prefixo de cron job removido antes de exibir ao usuário", () => {
    const cronMessage =
      "[IMPORTANT: You are running as a scheduled cron job. DELIVERY: Auto-delivered.]\n\nResultado real aqui.";
    const filtered = filterSystemContent(cronMessage);
    expect(filtered).not.toContain("[IMPORTANT:");
    expect(filtered).toContain("Resultado real");
  });

  it("req10: resposta [SILENT] é suprimida completamente", () => {
    expect(filterSystemContent("[SILENT]")).toBe("");
  });
});
