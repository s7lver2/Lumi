// packages/api-usage/src/free-tier.ts
export function freeAllowanceUsd(
  creditUsd: number,
  freeImages: number,
  pricePerImageUsd: number
): number {
  return Math.max(0, creditUsd) + Math.max(0, freeImages) * Math.max(0, pricePerImageUsd);
}

export interface NetCostInput {
  monthSpendUsd: number; // gross month-to-date, from api_usage
  jobCostUsd: number; // gross cost of this job
  freeUsd: number; // total monthly free allowance in USD
}

export interface NetCostBreakdown {
  freeRemainingUsd: number;
  netJobUsd: number;
  netMonthTotalUsd: number;
}

/** Nets Google's monthly free allowance out of a job's cost (spec §12). */
export function netCostBreakdown({ monthSpendUsd, jobCostUsd, freeUsd }: NetCostInput): NetCostBreakdown {
  const netMonthBefore = Math.max(0, monthSpendUsd - freeUsd);
  const netMonthTotalUsd = Math.max(0, monthSpendUsd + jobCostUsd - freeUsd);
  return {
    freeRemainingUsd: Math.max(0, freeUsd - monthSpendUsd),
    netJobUsd: netMonthTotalUsd - netMonthBefore,
    netMonthTotalUsd,
  };
}