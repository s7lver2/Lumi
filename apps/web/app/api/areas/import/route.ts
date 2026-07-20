// apps/web/app/api/areas/import/route.ts
import JSZip from "jszip";
import { NextResponse } from "next/server";
import { access, mkdir, writeFile } from "node:fs/promises";
import { getPool } from "../../../../lib/db";
import { streetViewImageDir, captureImagePath } from "../../../../lib/street-view-image-dir";

interface ManifestImage {
  panoId: string;
  heading: number;
  lat: number;
  lng: number;
  streetViewDate: string | null;
  embedding: number[] | null;
  hasFile: boolean;
}

interface ManifestPoint {
  panoId: string;
  lat: number;
  lng: number;
  embedding: number[] | null;
}

interface ManifestArea {
  name: string | null;
  geometryWkt: string;
  areaKm2: number;
  status: string;
  pointsEstimated: number;
  pointsCaptured: number;
  pointsFailed: number;
  imagesEmbedded: number;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
  images: ManifestImage[];
  points: ManifestPoint[];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  let manifest: { areas?: ManifestArea[] };
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
    const manifestFile = zip.file("manifest.json");
    if (!manifestFile) throw new Error("manifest.json missing from zip");
    manifest = JSON.parse(await manifestFile.async("string"));
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid export file: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 }
    );
  }

  const pool = getPool();
  const imageDir = streetViewImageDir();
  await mkdir(imageDir, { recursive: true });

  const importedAreaIds: string[] = [];

  for (const area of manifest.areas ?? []) {
    const { rows } = await pool.query(
      `INSERT INTO areas (name, geometry, area_km2, status, points_estimated, points_captured,
                          points_failed, images_embedded, estimated_cost_usd, actual_cost_usd)
       VALUES ($1, ST_GeomFromText($2, 4326), $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        area.name ?? null,
        area.geometryWkt,
        area.areaKm2,
        area.status ?? "indexed",
        area.pointsEstimated ?? 0,
        area.pointsCaptured ?? 0,
        area.pointsFailed ?? 0,
        area.imagesEmbedded ?? 0,
        area.estimatedCostUsd ?? null,
        area.actualCostUsd ?? null,
      ]
    );
    const areaId = rows[0].id as string;
    importedAreaIds.push(areaId);

    for (const img of area.images ?? []) {
      let imagePath: string | null = null;
      if (img.hasFile) {
        const zipEntry = zip.file(`images/${img.panoId}_${img.heading}.jpg`);
        if (zipEntry) {
          imagePath = captureImagePath(img.panoId, img.heading);
          // Images are shared/deduped by (pano_id, heading) across areas
          // (indexed_images' UNIQUE constraint is global, not per-area) — if
          // this exact capture is already on disk (re-importing, or another
          // area already captured it), leave the existing file alone rather
          // than overwrite it.
          if (!(await fileExists(imagePath))) {
            await writeFile(imagePath, await zipEntry.async("nodebuffer"));
          }
        }
      }
      const embeddingLiteral = img.embedding ? `[${img.embedding.join(",")}]` : null;
      // embeddedAt computed in JS and bound as its own parameter — see
      // apps/web/app/api/datasets/install/run-job.ts's identical fix for
      // why reusing $6 inside a bare `CASE WHEN $6 IS NOT NULL` throws
      // "could not determine data type of parameter $6" when it's NULL.
      const embeddedAt = embeddingLiteral !== null ? new Date() : null;
      await pool.query(
        `INSERT INTO indexed_images (area_id, pano_id, heading, location, street_view_date, embedding, image_path, embedded_at)
         VALUES ($1, $2, $3, ST_GeogFromText($4), $5, $6, $7, $8)
         ON CONFLICT (pano_id, heading) DO NOTHING`,
        [areaId, img.panoId, img.heading, `POINT(${img.lng} ${img.lat})`, img.streetViewDate ?? null, embeddingLiteral, imagePath, embeddedAt]
      );
    }

    for (const pt of area.points ?? []) {
      const embeddingLiteral = pt.embedding ? `[${pt.embedding.join(",")}]` : null;
      await pool.query(
        `INSERT INTO indexed_points (area_id, pano_id, location, embedding)
         VALUES ($1, $2, ST_GeogFromText($3), $4)
         ON CONFLICT (pano_id) DO NOTHING`,
        [areaId, pt.panoId, `POINT(${pt.lng} ${pt.lat})`, embeddingLiteral]
      );
    }
  }

  return NextResponse.json({ importedAreaIds }, { status: 201 });
}
