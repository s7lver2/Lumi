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
import { enqueueIndexAreaJob } from "../../../lib/queue";

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

  const pool = getPool();
  const polygonWkt = `POLYGON((${body.polygon.map(([lng, lat]) => `${lng} ${lat}`).join(", ")}))`;
  const { rows } = await pool.query(
    `INSERT INTO areas (name, geometry, area_km2, status, points_estimated, estimated_cost_usd)
     VALUES ($1, ST_GeomFromText($2, 4326), $3, 'pending', $4, $5)
     RETURNING id`,
    [body.name ?? null, polygonWkt, body.areaKm2, points.length, estimatedCostUsd]
  );
  const areaId = rows[0].id as string;

  await enqueueIndexAreaJob({ areaId });

  return NextResponse.json(
    { areaId, pointsEstimated: points.length, estimatedCostUsd },
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