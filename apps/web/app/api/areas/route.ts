// apps/web/app/api/areas/route.ts
import { NextResponse } from "next/server";
import {
  fetchStreetGeometry,
  samplePointsAlongStreets,
  estimateIndexingCostUsd,
  assertAreaWithinSizeLimit,
} from "@netryx/geo-sampling";
import { STREET_VIEW_HEADINGS } from "@netryx/shared-types";
import { getSettingsRepo } from "../../../lib/settings-repo";
import { getPool } from "../../../lib/db";
import { countReusableImages } from "../../../lib/reuse-estimate";
import { polygonToWkt } from "../../../lib/polygon-wkt";
import { enqueueIndexAreaJob } from "../../../lib/queue";
import { BudgetExceededError, getMonthlySpendUsd, freeAllowanceUsd, netCostBreakdown } from "@netryx/api-usage";

// The GET below takes no request params, so Next's static-analysis treats it
// as eligible for build-time prerendering by default — it would freeze the
// areas list at whatever existed during the build (same fix as
// apps/web/app/api/health/route.ts).
export const dynamic = "force-dynamic";

const SAMPLING_SPACING_METERS = 18;

interface CreateAreaBody {
  polygon?: [number, number][];
  areaKm2?: number;
  name?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateAreaBody;

  if (!body.polygon || !Array.isArray(body.polygon) || body.polygon.length < 4) {
    return NextResponse.json({ error: "polygon is required" }, { status: 400 });
  }
  if (typeof body.areaKm2 !== "number") {
    return NextResponse.json({ error: "areaKm2 is required" }, { status: 400 });
  }

  const repo = getSettingsRepo();
  const maxAreaKm2 = Number((await repo.getSetting("MAX_AREA_KM2")) ?? "5");
  const pricePerImageUsd = Number(
    (await repo.getSetting("STREET_VIEW_PRICE_PER_IMAGE_USD")) ?? "0.007"
  );
  const maxMonthlyBudgetUsd = Number((await repo.getSetting("MAX_MONTHLY_BUDGET_USD")) ?? "50");

  try {
    assertAreaWithinSizeLimit(body.areaKm2, maxAreaKm2);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  let lines: Awaited<ReturnType<typeof fetchStreetGeometry>>;
  try {
    lines = await fetchStreetGeometry(body.polygon);
  } catch (err) {
    // Overpass is shared public infrastructure and does fail under load even
    // after fetchStreetGeometry's own retries are exhausted — surface a
    // clean, actionable error instead of an unhandled 500.
    return NextResponse.json(
      { error: `Could not reach the street data service — try again in a moment (${err instanceof Error ? err.message : String(err)})` },
      { status: 502 }
    );
  }

  const points = samplePointsAlongStreets(lines, SAMPLING_SPACING_METERS, body.polygon);
  const pool = getPool();
  const reusableImages = await countReusableImages(pool, body.polygon);
  const estimatedCostUsd = estimateIndexingCostUsd(
    points.length,
    STREET_VIEW_HEADINGS.length,
    pricePerImageUsd,
    reusableImages
  );

  const creditUsd = Number((await repo.getSetting("GOOGLE_FREE_MONTHLY_CREDIT_USD")) ?? "0");
  const freeImages = Number((await repo.getSetting("GOOGLE_FREE_MONTHLY_IMAGES")) ?? "0");
  const freeUsd = freeAllowanceUsd(creditUsd, freeImages, pricePerImageUsd);
  const monthSpendUsd = await getMonthlySpendUsd(pool);
  const net = netCostBreakdown({ monthSpendUsd, jobCostUsd: estimatedCostUsd, freeUsd });
  if (net.netMonthTotalUsd > maxMonthlyBudgetUsd) {
    return NextResponse.json(
      { error: new BudgetExceededError(Math.max(0, monthSpendUsd - freeUsd), net.netJobUsd, maxMonthlyBudgetUsd).message },
      { status: 400 }
    );
  }

  const polygonWkt = polygonToWkt(body.polygon);
  const { rows } = await pool.query(
    `INSERT INTO areas (name, geometry, area_km2, status, points_estimated, estimated_cost_usd)
     VALUES ($1, ST_GeomFromText($2, 4326), $3, 'pending', $4, $5)
     RETURNING id`,
    [body.name ?? null, polygonWkt, body.areaKm2, points.length, estimatedCostUsd]
  );
  const areaId = rows[0].id as string;

  await enqueueIndexAreaJob({ areaId });

  return NextResponse.json(
    { areaId, pointsEstimated: points.length, estimatedCostUsd, reusableImages },
    { status: 201 }
  );
}

export async function GET() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, name, area_km2, status, points_estimated, points_captured,
            points_failed, images_embedded, estimated_cost_usd, actual_cost_usd, created_at
     FROM areas ORDER BY created_at DESC`
  );
  return NextResponse.json({ areas: rows });
}