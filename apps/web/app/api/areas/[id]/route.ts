// apps/web/app/api/areas/[id]/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../../lib/db";
import { enqueueIndexAreaJob } from "../../../../lib/queue";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const pool = getPool();
  const areaRes = await pool.query(
    `SELECT id, name, area_km2, status, points_estimated, points_captured,
            points_failed, images_embedded, estimated_cost_usd, actual_cost_usd, created_at,
            ST_AsGeoJSON(geometry) AS geometry
     FROM areas WHERE id = $1`,
    [params.id]
  );
  if (areaRes.rows.length === 0) {
    return NextResponse.json({ error: "area not found" }, { status: 404 });
  }
  const pointsRes = await pool.query(
    `SELECT id, pano_id, heading,
            ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
     FROM indexed_images WHERE area_id = $1`,
    [params.id]
  );
  const points: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: pointsRes.rows.map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [Number(r.lng), Number(r.lat)] },
      properties: { id: r.id, panoId: r.pano_id, heading: r.heading },
    })),
  };
  const a = areaRes.rows[0];
  return NextResponse.json({
    area: { ...a, geometry: JSON.parse(a.geometry) },
    points,
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const pool = getPool();

  // A "pending"/"indexing" area can have a worker job actively inserting
  // indexed_images rows for it right now (apps/worker/src/jobs/index-area.ts).
  // Deleting it mid-job races that insert — confirmed live: "violates foreign
  // key constraint indexed_images_area_id_fkey" when an area was deleted
  // while its job was still running. Cancel first (POST .../cancel) so the
  // worker actually stops before it's safe to delete.
  const existing = await pool.query<{ status: string }>(`SELECT status FROM areas WHERE id = $1`, [params.id]);
  if (existing.rows.length === 0) return NextResponse.json({ error: "area not found" }, { status: 404 });
  if (["pending", "indexing"].includes(existing.rows[0].status)) {
    return NextResponse.json(
      { error: `cannot delete an area in status "${existing.rows[0].status}" — cancel it first` },
      { status: 409 }
    );
  }

  const res = await pool.query(`DELETE FROM areas WHERE id = $1`, [params.id]);
  if (res.rowCount === 0) return NextResponse.json({ error: "area not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 }); // indexed_images cascade on FK
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "reindex") {
    return NextResponse.json({ error: "unsupported action" }, { status: 400 });
  }
  const pool = getPool();
  const res = await pool.query(
    `UPDATE areas SET status = 'pending' WHERE id = $1 RETURNING id`,
    [params.id]
  );
  if (res.rowCount === 0) return NextResponse.json({ error: "area not found" }, { status: 404 });
  await enqueueIndexAreaJob({ areaId: params.id });
  return NextResponse.json({ areaId: params.id }, { status: 202 });
}