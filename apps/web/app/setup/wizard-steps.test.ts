// apps/web/app/setup/wizard-steps.test.ts
import { describe, it, expect } from "vitest";
import { WIZARD_STEPS, nextStep, prevStep, isComplete } from "./wizard-steps";

describe("wizard steps", () => {
  it("orders the four steps and walks forward/back", () => {
    expect(WIZARD_STEPS.map((s) => s.id)).toEqual(["install", "database", "credentials", "confirm"]);
    expect(nextStep("install")).toBe("database");
    expect(prevStep("credentials")).toBe("database");
    expect(nextStep("confirm")).toBeNull();
    expect(prevStep("install")).toBeNull();
    expect(isComplete("confirm")).toBe(true);
    expect(isComplete("install")).toBe(false);
  });
});