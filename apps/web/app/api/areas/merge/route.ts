// apps/web/app/api/areas/merge/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../../lib/db";

interface MergeBody {
  areaIds?: string[];
  name?: string;
}

interface SourceAreaRow {
  id: string;
  status: string;
  points_estimated: number;
  points_captured: number;
  points_failed: number;
  images_embedded: number;
  estimated_cost_usd: string | null;
  actual_cost_usd: string | null;
}

function sumField(sources: SourceAreaRow[], key: keyof SourceAreaRow): number {
  return sources.reduce((acc, s) => acc + Number(s[key] ?? 0), 0);
}

export async function POST(request: Request) {
  const body = (await request.json()) as MergeBody;
  if (!body.areaIds || !Array.isArray(body.areaIds) || body.areaIds.length < 2) {
    return NextResponse.json({ error: "at least 2 areaIds are required to merge" }, { status: 400 });
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: sources } = await client.query<SourceAreaRow>(
      `SELECT id, status, points_estimated, points_captured, points_failed,
              images_embedded, estimated_cost_usd, actual_cost_usd
       FROM areas WHERE id = ANY($1) FOR UPDATE`,
      [body.areaIds]
    );
    if (sources.length !== body.areaIds.length) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "one or more areas not found" }, { status: 404 });
    }

    // A "pending"/"indexing" area can have a worker job actively inserting
    // indexed_images rows for it right now (apps/worker/src/jobs/index-area.ts).
    // Reassigning/deleting it mid-job races that insert — confirmed live:
    // "violates foreign key constraint indexed_images_area_id_fkey" when an
    // area was merged/deleted while its job was still running. Cancel the
    // area first (POST /api/areas/:id/cancel) so the worker actually stops
    // before it's safe to merge.
    const active = sources.find((s) => s.status === "pending" || s.status === "indexing");
    if (active) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `Area ${active.id} is still ${active.status} — cancel it first before merging` },
        { status: 409 }
      );
    }

    // ST_ConvexHull, not ST_Union directly: areas.geometry is a single
    // Polygon column (not MultiPolygon) — if the source areas don't overlap
    // or touch, ST_Union alone can produce a MultiPolygon, which Postgres
    // rejects on insert here. The convex hull of the union is always a
    // single Polygon; for merge's actual use case (combining
    // overlapping/adjacent draws of roughly the same physical zone) this
    // matches the drawn areas closely. It can include a sliver of extra
    // area between disjoint pieces — an acceptable trade-off for always
    // getting a valid geometry rather than a feature this merge supports.
    const { rows: geomRows } = await client.query<{ geometry_wkt: string; area_km2: string }>(
      `SELECT ST_AsText(ST_ConvexHull(ST_Union(geometry))) AS geometry_wkt,
              (ST_Area(ST_ConvexHull(ST_Union(geometry))::geography) / 1000000) AS area_km2
       FROM areas WHERE id = ANY($1)`,
      [body.areaIds]
    );
    const { geometry_wkt: geometryWkt, area_km2: areaKm2 } = geomRows[0];

    const allIndexed = sources.every((s) => s.status === "indexed");

    const { rows: inserted } = await client.query<{ id: string }>(
      `INSERT INTO areas (name, geometry, area_km2, status, points_estimated, points_captured,
                          points_failed, images_embedded, estimated_cost_usd, actual_cost_usd)
       VALUES ($1, ST_GeomFromText($2, 4326), $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        body.name ?? null,
        geometryWkt,
        areaKm2,
        allIndexed ? "indexed" : "pending",
        sumField(sources, "points_estimated"),
        sumField(sources, "points_captured"),
        sumField(sources, "points_failed"),
        sumField(sources, "images_embedded"),
        sumField(sources, "estimated_cost_usd"),
        sumField(sources, "actual_cost_usd"),
      ]
    );
    const mergedAreaId = inserted[0].id;

    // (pano_id, heading) and (pano_id) are UNIQUE globally on indexed_images/
    // indexed_points (not per-area, spec: db/migrations/1720400000000_init.js
    // and 1720500000000_search_retrieval_indexes.js), so no two source areas
    // can already share a row here — a plain reassignment can't collide.
    await client.query(`UPDATE indexed_images SET area_id = $1 WHERE area_id = ANY($2)`, [mergedAreaId, body.areaIds]);
    await client.query(`UPDATE indexed_points SET area_id = $1 WHERE area_id = ANY($2)`, [mergedAreaId, body.areaIds]);

    // Source areas' indexed_images/indexed_points rows were just reassigned
    // away above, so this delete cascades nothing for them — safe even
    // though search_candidates.indexed_image_id has no ON DELETE action
    // (see apps/web/app/api/areas/[id]/route.ts's DELETE handler), since
    // those image rows now belong to mergedAreaId, not the deleted areas.
    await client.query(`DELETE FROM areas WHERE id = ANY($1)`, [body.areaIds]);

    await client.query("COMMIT");
    return NextResponse.json({ areaId: mergedAreaId }, { status: 201 });
  } catch (err) {
    await client.query("ROLLBACK");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  } finally {
    client.release();
  }
}
