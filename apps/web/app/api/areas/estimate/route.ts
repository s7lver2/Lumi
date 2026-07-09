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

  const lines = await fetchStreetGeometry(body.polygon);
  const points = samplePointsAlongStreets(lines, SAMPLING_SPACING_METERS);
  const estimatedCostUsd = estimateIndexingCostUsd(
    points.length,
    STREET_VIEW_HEADINGS.length,
    pricePerImageUsd
  );

  return NextResponse.json({ pointsEstimated: points.length, estimatedCostUsd });
}