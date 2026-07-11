// apps/web/app/api/areas/export/route.ts
import JSZip from "jszip";
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { getPool } from "../../../../lib/db";

interface ExportBody {
  areaIds?: string[];
}

/** Parses pgvector's text output ("[1,2,3]") back into a number[]. Same shape as apps/web/lib/search/retrieval.ts's parseVector. */
function parseVector(text: string | null): number[] | null {
  if (!text) return null;
  return text.slice(1, -1).split(",").map(Number);
}

export async function POST(request: Request) {
  const body = (await request.json()) as ExportBody;
  if (!body.areaIds || !Array.isArray(body.areaIds) || body.areaIds.length === 0) {
    return NextResponse.json({ error: "areaIds is required" }, { status: 400 });
  }

  const pool = getPool();
  const { rows: areaRows } = await pool.query(
    `SELECT id, name, ST_AsText(geometry) AS geometry_wkt, area_km2, status,
            points_estimated, points_captured, points_failed, images_embedded,
            estimated_cost_usd, actual_cost_usd
     FROM areas WHERE id = ANY($1)`,
    [body.areaIds]
  );
  if (areaRows.length === 0) {
    return NextResponse.json({ error: "no matching areas" }, { status: 404 });
  }

  const zip = new JSZip();
  const manifestAreas: unknown[] = [];

  for (const area of areaRows) {
    const { rows: images } = await pool.query(
      `SELECT pano_id, heading, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
              street_view_date, embedding::text AS embedding_text, image_path
       FROM indexed_images WHERE area_id = $1`,
      [area.id]
    );
    const { rows: points } = await pool.query(
      `SELECT pano_id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
              embedding::text AS embedding_text
       FROM indexed_points WHERE area_id = $1`,
      [area.id]
    );

    const imageEntries = [];
    for (const img of images) {
      // image_path is nullable (older rows predate that column, spec §note
      // in db/migrations/1720600000000_indexed_images_image_path.js) and the
      // file it points to can also just be missing on disk — export the
      // metadata/embedding either way (still useful for search dedup on
      // import) and only bundle the actual .jpg when it's actually readable.
      let hasFile = false;
      if (img.image_path) {
        try {
          const bytes = await readFile(img.image_path);
          zip.file(`images/${img.pano_id}_${img.heading}.jpg`, bytes);
          hasFile = true;
        } catch {
          // missing on disk — proceed without the file
        }
      }
      imageEntries.push({
        panoId: img.pano_id,
        heading: img.heading,
        lat: Number(img.lat),
        lng: Number(img.lng),
        streetViewDate: img.street_view_date,
        embedding: parseVector(img.embedding_text),
        hasFile,
      });
    }

    const pointEntries = points.map((p) => ({
      panoId: p.pano_id,
      lat: Number(p.lat),
      lng: Number(p.lng),
      embedding: parseVector(p.embedding_text),
    }));

    manifestAreas.push({
      name: area.name,
      geometryWkt: area.geometry_wkt,
      areaKm2: Number(area.area_km2),
      status: area.status,
      pointsEstimated: area.points_estimated,
      pointsCaptured: area.points_captured,
      pointsFailed: area.points_failed,
      imagesEmbedded: area.images_embedded,
      estimatedCostUsd: area.estimated_cost_usd,
      actualCostUsd: area.actual_cost_usd,
      images: imageEntries,
      points: pointEntries,
    });
  }

  zip.file(
    "manifest.json",
    JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), areas: manifestAreas }, null, 2)
  );

  const buffer = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const filename = `lumi-areas-${new Date().toISOString().slice(0, 10)}.zip`;
  // BodyInit as typed here rejects Uint8Array<ArrayBufferLike> (a lib.dom.d.ts
  // generic-strictness quirk) even though a Uint8Array is a valid fetch Response
  // body at runtime — cast, not a real type mismatch.
  return new NextResponse(buffer as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
