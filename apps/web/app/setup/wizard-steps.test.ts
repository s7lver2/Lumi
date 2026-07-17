// apps/web/app/setup/wizard-steps.test.ts
import { describe, it, expect } from "vitest";
import { WIZARD_STEPS, nextStep, prevStep, isComplete } from "./wizard-steps";

describe("wizard steps", () => {
  it("orders the six steps and walks forward/back", () => {
    expect(WIZARD_STEPS.map((s) => s.id)).toEqual(["install", "usage", "models", "database", "credentials", "confirm"]);
    expect(nextStep("install")).toBe("usage");
    expect(nextStep("usage")).toBe("models");
    expect(nextStep("models")).toBe("database");
    expect(prevStep("database")).toBe("models");
    expect(prevStep("models")).toBe("usage");
    expect(prevStep("usage")).toBe("install");
    expect(prevStep("credentials")).toBe("database");
    expect(nextStep("confirm")).toBeNull();
    expect(prevStep("install")).toBeNull();
    expect(isComplete("confirm")).toBe(true);
    expect(isComplete("install")).toBe(false);
    expect(isComplete("usage")).toBe(false);
    expect(isComplete("models")).toBe(false);
  });
});
