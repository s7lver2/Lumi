// apps/web/app/api/datasets/install/run-job.ts
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import JSZip from "jszip";
import { RETRIEVAL_MODELS } from "@netryx/shared-types";
import { decryptBuffer } from "@netryx/settings-repo";
import { streetViewImageDir, captureImagePath } from "../../../../lib/street-view-image-dir";
import { downloadReleaseAsset } from "../../../../lib/datasets/github";
import { validateDatasetManifest } from "../../../../lib/datasets/manifest";
import { DATASET_SHARED_KEY } from "../../../../lib/datasets/shared-key";
import {
  assertCompressedSizeWithinLimit,
  assertFileCountWithinLimit,
  assertDecompressedSizeWithinLimit,
  isLikelyJpeg,
} from "../../../../lib/datasets/validate-bundle";
import { enqueueEmbedPendingImagesJob } from "../../../../lib/queue";
import { createJob, completeJob, failJob } from "../../../../lib/background-jobs";

const KNOWN_MODEL_IDS = new Set(RETRIEVAL_MODELS.map((m) => m.id));

/** The actual dataset install work (download bundle, stage images, write
 * areas/indexed_images/indexed_points, maybe enqueue an embed job) — split
 * out of route.ts (not just POST) because Next.js's App Router only
 * allows route files to export HTTP method handlers and a small config
 * allowlist; any other export fails `next build`'s route type-checking
 * (confirmed live: `next build` rejected `runDatasetInstallJob` exported
 * from route.ts with "Property ... is incompatible with index signature").
 * Runs detached from the request and is driven directly from
 * run-job.test.ts. */
export async function runDatasetInstallJob(
  pool: Pool,
  jobId: string,
  args: {
    bundleAssetUrl: string;
    token: string | undefined;
    compatible: boolean;
  }
): Promise<void> {
  const stagingDir = await mkdtemp(join(tmpdir(), "lumi-dataset-"));
  const stagedImages: { panoId: string; heading: number; bytes: Buffer }[] = [];
  let decompressedTotal = 0;

  try {
    const bundleBytes = await downloadReleaseAsset(args.bundleAssetUrl, args.token);
    const decrypted = decryptBuffer(bundleBytes, DATASET_SHARED_KEY);
    assertCompressedSizeWithinLimit(decrypted.length);

    const zip = await JSZip.loadAsync(decrypted);
    assertFileCountWithinLimit(Object.keys(zip.files).length);
    const manifestFile = zip.file("manifest.json");
    if (!manifestFile) throw new Error("manifest.json missing from bundle");
    const manifest = validateDatasetManifest(JSON.parse(await manifestFile.async("string")), KNOWN_MODEL_IDS);
    if (manifest.areas.length !== 1) {
      throw new Error(`expected exactly 1 area in the bundle, got ${manifest.areas.length}`);
    }

    for (const area of manifest.areas) {
      for (const img of area.images) {
        if (!img.hasFile) continue;
        const entry = zip.file(`images/${img.panoId}_${img.heading}.jpg`);
        if (!entry) continue;
        const bytes = Buffer.from(await entry.async("nodebuffer"));
        decompressedTotal += bytes.length;
        assertDecompressedSizeWithinLimit(decompressedTotal);
        if (!isLikelyJpeg(bytes)) {
          throw new Error(`images/${img.panoId}_${img.heading}.jpg does not look like a real JPEG`);
        }
        const stagedPath = join(stagingDir, `${img.panoId}_${img.heading}.jpg`);
        await writeFile(stagedPath, bytes);
        stagedImages.push({ panoId: img.panoId, heading: img.heading, bytes });
      }
    }

    await mkdir(streetViewImageDir(), { recursive: true });
    let areaId = "";
    for (const area of manifest.areas) {
      const { rows } = await pool.query(
        `INSERT INTO areas (name, geometry, area_km2, status, points_estimated, points_captured,
                            points_failed, images_embedded, estimated_cost_usd, actual_cost_usd)
         VALUES ($1, ST_GeomFromText($2, 4326), $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          area.name, area.geometryWkt, area.areaKm2,
          args.compatible ? area.status : "pending",
          area.pointsEstimated, area.pointsCaptured, area.pointsFailed,
          args.compatible ? area.imagesEmbedded : 0,
          area.estimatedCostUsd, area.actualCostUsd,
        ]
      );
      areaId = rows[0].id as string;

      for (const img of area.images) {
        const staged = stagedImages.find((s) => s.panoId === img.panoId && s.heading === img.heading);
        const imagePath = staged ? captureImagePath(img.panoId, img.heading) : null;
        if (staged && imagePath) {
          await writeFile(imagePath, staged.bytes);
        }
        const embeddingLiteral = args.compatible && img.embedding ? `[${img.embedding.join(",")}]` : null;
        await pool.query(
          `INSERT INTO indexed_images (area_id, pano_id, heading, location, street_view_date, embedding, image_path, embedded_at)
           VALUES ($1, $2, $3, ST_GeogFromText($4), $5, $6, $7, CASE WHEN $6 IS NOT NULL THEN now() ELSE NULL END)
           ON CONFLICT (pano_id, heading) DO NOTHING`,
          [areaId, img.panoId, img.heading, `POINT(${img.lng} ${img.lat})`, img.streetViewDate, embeddingLiteral, imagePath]
        );
      }

      for (const pt of area.points) {
        const embeddingLiteral = args.compatible && pt.embedding ? `[${pt.embedding.join(",")}]` : null;
        await pool.query(
          `INSERT INTO indexed_points (area_id, pano_id, location, embedding)
           VALUES ($1, $2, ST_GeogFromText($3), $4)
           ON CONFLICT (pano_id) DO NOTHING`,
          [areaId, pt.panoId, `POINT(${pt.lng} ${pt.lat})`, embeddingLiteral]
        );
      }
    }

    if (!args.compatible) {
      await enqueueEmbedPendingImagesJob({ areaId });
    }

    await completeJob(pool, jobId, { areaId, compatible: args.compatible });
  } catch (err) {
    await failJob(pool, jobId, err instanceof Error ? err.message : String(err));
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}
