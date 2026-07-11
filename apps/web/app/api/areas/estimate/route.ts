// apps/web/app/api/areas/estimate/route.ts
import { NextResponse } from "next/server";
import {
  fetchStreetGeometry,
  samplePointsAlongStreets,
  estimateIndexingCostUsd,
  assertAreaWithinSizeLimit,
} from "@netryx/geo-sampling";
import { STREET_VIEW_HEADINGS } from "@netryx/shared-types";
import { getSettingsRepo } from "../../../../lib/settings-repo";
import { getPool } from "../../../../lib/db";
import { countReusableImages } from "../../../../lib/reuse-estimate";
import { getMonthlySpendUsd, freeAllowanceUsd, netCostBreakdown } from "@netryx/api-usage";

const SAMPLING_SPACING_METERS = 18;

interface EstimateBody {
  polygon?: [number, number][];
  areaKm2?: number;
}

export async function POST(request: Request) {
  const body = (await request.json()) as EstimateBody;
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
  return NextResponse.json({
    pointsEstimated: points.length,
    estimatedCostUsd,            // gross, after reuse discount
    reusableImages,
    netCostUsd: net.netJobUsd,   // after free tier
    freeRemainingUsd: net.freeRemainingUsd,
  });
}