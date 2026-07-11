// packages/api-usage/src/free-tier.test.ts
import { describe, it, expect } from "vitest";
import { freeAllowanceUsd, netCostBreakdown } from "./free-tier";

describe("freeAllowanceUsd", () => {
  it("sums the USD credit and the value of free images", () => {
    expect(freeAllowanceUsd(200, 10000, 0.007)).toBeCloseTo(270, 5); // 200 + 10000*0.007
  });
});

describe("netCostBreakdown", () => {
  it("charges nothing while the month stays under the free allowance", () => {
    const b = netCostBreakdown({ monthSpendUsd: 10, jobCostUsd: 20, freeUsd: 100 });
    expect(b.netJobUsd).toBe(0);
    expect(b.freeRemainingUsd).toBeCloseTo(90, 5);
    expect(b.netMonthTotalUsd).toBe(0);
  });
  it("charges only the portion of the job beyond the free allowance", () => {
    const b = netCostBreakdown({ monthSpendUsd: 90, jobCostUsd: 30, freeUsd: 100 });
    // month already used 90 of 100 free; job of 30 -> 10 free left covers 10, 20 billable
    expect(b.netJobUsd).toBeCloseTo(20, 5);
    expect(b.freeRemainingUsd).toBeCloseTo(10, 5);
    expect(b.netMonthTotalUsd).toBeCloseTo(20, 5);
  });
});