// apps/web/app/api/settings/model-usage/route.ts
import { NextResponse } from "next/server";
import { getModelUsageSummary } from "@netryx/model-usage";
import { getPool } from "../../../../lib/db";

export async function GET() {
  const pool = getPool();
  const summary = await getModelUsageSummary(pool);
  return NextResponse.json(summary);
}
