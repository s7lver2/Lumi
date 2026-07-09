// apps/web/app/setup/wizard-steps.test.ts
import { describe, it, expect } from "vitest";
import { WIZARD_STEPS, nextStep, prevStep, isComplete } from "./wizard-steps";

describe("wizard steps", () => {
  it("orders the five steps and walks forward/back", () => {
    expect(WIZARD_STEPS.map((s) => s.id)).toEqual(["prereqs", "migrate", "credentials", "inference", "confirm"]);
    expect(nextStep("prereqs")).toBe("migrate");
    expect(prevStep("credentials")).toBe("migrate");
    expect(nextStep("confirm")).toBeNull();
    expect(prevStep("prereqs")).toBeNull();
    expect(isComplete("confirm")).toBe(true);
  });
});