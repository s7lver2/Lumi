// apps/web/app/setup/wizard-steps.test.ts
import { describe, it, expect } from "vitest";
import { WIZARD_STEPS, nextStep, isComplete } from "./wizard-steps";
it("advances through the steps in order and completes at the end", () => {
  expect(WIZARD_STEPS[0].id).toBe("prereqs");
  expect(nextStep("prereqs")).toBe("migrate");
  expect(nextStep("credentials")).toBe("inference");
  expect(nextStep("confirm")).toBeNull();
  expect(isComplete("confirm")).toBe(true);
});