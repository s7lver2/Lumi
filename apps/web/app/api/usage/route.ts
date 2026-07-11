// apps/web/app/api/usage/route.ts
import { NextResponse } from "next/server";
import { getMonthlySpendUsd } from "@netryx/api-usage";
import { getPool } from "../../../lib/db";
import { getSettingsRepo } from "../../../lib/settings-repo";
import { freeAllowanceUsd } from "@netryx/api-usage";

export async function GET() {
  const pool = getPool();
  const repo = getSettingsRepo();
  const monthlyBudgetUsd = Number((await repo.getSetting("MAX_MONTHLY_BUDGET_USD")) ?? "50");
  const monthlySpendUsd = await getMonthlySpendUsd(pool);

  const pricePerImageUsd = Number((await repo.getSetting("STREET_VIEW_PRICE_PER_IMAGE_USD")) ?? "0.007");
  const creditUsd = Number((await repo.getSetting("GOOGLE_FREE_MONTHLY_CREDIT_USD")) ?? "0");
  const freeImages = Number((await repo.getSetting("GOOGLE_FREE_MONTHLY_IMAGES")) ?? "0");
  const freeUsd = freeAllowanceUsd(creditUsd, freeImages, pricePerImageUsd);
  return NextResponse.json({
    monthlySpendUsd, monthlyBudgetUsd,
    freeAllowanceUsd: freeUsd,
    freeRemainingUsd: Math.max(0, freeUsd - monthlySpendUsd),
    netSpendUsd: Math.max(0, monthlySpendUsd - freeUsd),
    remainingUsd: Math.max(0, monthlyBudgetUsd - Math.max(0, monthlySpendUsd - freeUsd)),
  });
}