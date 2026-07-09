// apps/web/app/api/usage/route.ts
import { NextResponse } from "next/server";
import { getMonthlySpendUsd } from "@netryx/api-usage";
import { getPool } from "../../../lib/db";
import { getSettingsRepo } from "../../../lib/settings-repo";

export async function GET() {
  const pool = getPool();
  const monthlyBudgetUsd = Number((await getSettingsRepo().getSetting("MAX_MONTHLY_BUDGET_USD")) ?? "50");
  const monthlySpendUsd = await getMonthlySpendUsd(pool);
  return NextResponse.json({
    monthlySpendUsd,
    monthlyBudgetUsd,
    remainingUsd: Math.max(0, monthlyBudgetUsd - monthlySpendUsd),
  });
}