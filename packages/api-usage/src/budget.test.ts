// packages/api-usage/src/budget.test.ts
import { describe, it, expect } from "vitest";
import { projectedCostUsd, assertWithinMonthlyBudget, BudgetExceededError } from "./budget";

describe("projectedCostUsd", () => {
  it("multiplies points × headings × price", () => {
    expect(projectedCostUsd(1000, 4, 0.007)).toBeCloseTo(28.0, 5);
  });
});

describe("assertWithinMonthlyBudget", () => {
  it("passes when spent + projected is within the budget", () => {
    expect(() => assertWithinMonthlyBudget(10, 15, 50)).not.toThrow();
  });
  it("throws BudgetExceededError when spent + projected exceeds the budget", () => {
    expect(() => assertWithinMonthlyBudget(40, 15, 50)).toThrow(BudgetExceededError);
    expect(() => assertWithinMonthlyBudget(40, 15, 50)).toThrow(/monthly budget/i);
  });
});