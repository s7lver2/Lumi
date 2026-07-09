// packages/api-usage/src/budget.ts
export class BudgetExceededError extends Error {
  constructor(spentUsd: number, projectedUsd: number, maxBudgetUsd: number) {
    super(
      `This job's estimated cost ($${projectedUsd.toFixed(2)}) plus this month's spend ` +
        `($${spentUsd.toFixed(2)}) would exceed the monthly budget of $${maxBudgetUsd.toFixed(2)}.`
    );
    this.name = "BudgetExceededError";
  }
}

/** Spec §12.1: points × headings × price per image. */
export function projectedCostUsd(
  pointsEstimated: number,
  headingsCount: number,
  pricePerImageUsd: number
): number {
  return pointsEstimated * headingsCount * pricePerImageUsd;
}

/** Spec §12.2 hard limit — throws if this job would push the month over budget. */
export function assertWithinMonthlyBudget(
  spentUsd: number,
  projectedUsd: number,
  maxBudgetUsd: number
): void {
  if (spentUsd + projectedUsd > maxBudgetUsd) {
    throw new BudgetExceededError(spentUsd, projectedUsd, maxBudgetUsd);
  }
}