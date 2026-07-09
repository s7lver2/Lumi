// apps/web/app/(protected)/layout.test.ts
import { describe, it, expect, vi } from "vitest";
import { resolveGateDecision } from "./gate";

describe("resolveGateDecision", () => {
  it("redirects to /setup when setup is not completed", async () => {
    const repo = { isSetupCompleted: vi.fn().mockResolvedValue(false) };
    const decision = await resolveGateDecision(repo as any);
    expect(decision).toEqual({ type: "redirect", to: "/setup" });
  });

  it("allows the request through when setup is completed", async () => {
    const repo = { isSetupCompleted: vi.fn().mockResolvedValue(true) };
    const decision = await resolveGateDecision(repo as any);
    expect(decision).toEqual({ type: "allow" });
  });
});