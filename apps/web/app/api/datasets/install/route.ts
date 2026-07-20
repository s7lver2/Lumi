// apps/web/app/api/datasets/install/route.ts
import { NextResponse } from "next/server";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { RETRIEVAL_MODELS } from "@netryx/shared-types";
import { decryptBuffer } from "@netryx/settings-repo";
import { getPool } from "../../../../lib/db";
import { streetViewImageDir, captureImagePath } from "../../../../lib/street-view-image-dir";
import { listReleasesForRepo, downloadReleaseAsset } from "../../../../lib/datasets/github";
import { getActiveModelTag } from "../../../../lib/datasets/active-model";
import { isCompatible } from "../../../../lib/datasets/compatibility";
import {
  validateDatasetManifest,
  BUNDLE_ASSET_NAME,
  METADATA_ASSET_NAME,
  type DatasetMetadata,
} from "../../../../lib/datasets/manifest";
import { DATASET_SHARED_KEY } from "../../../../lib/datasets/shared-key";
import {
  assertCompressedSizeWithinLimit,
  assertFileCountWithinLimit,
  assertDecompressedSizeWithinLimit,
  isLikelyJpeg,
} from "../../../../lib/datasets/validate-bundle";
import { enqueueEmbedPendingImagesJob } from "../../../../lib/queue";
import { getSettingsRepo } from "../../../../lib/settings-repo";

interface InstallBody {
  owner?: string;
  repo?: string;
  tag?: string;
  forceInstall?: boolean;
}

const KNOWN_MODEL_IDS = new Set(RETRIEVAL_MODELS.map((m) => m.id));

export async function POST(request: Request) {
  const body = (await request.json()) as InstallBody;
  if (!body.owner || !body.repo || !body.tag) {
    return NextResponse.json({ error: "owner, repo and tag are required" }, { status: 400 });
  }

  // Unauthenticated GitHub reads are capped at 60 req/hour — trivially
  // exhausted (confirmed live, same issue fixed in GET /api/datasets).
  const token = (await getSettingsRepo().getSetting("GITHUB_TOKEN")) ?? undefined;
  const releases = await listReleasesForRepo(body.owner, body.repo, token);
  const release = releases.find((r) => r.tagName === body.tag);
  if (!release) {
    return NextResponse.json({ error: "release not found" }, { status: 404 });
  }

  const metadataAsset = release.assets.find((a) => a.name === METADATA_ASSET_NAME);
  const bundleAsset = release.assets.find((a) => a.name === BUNDLE_ASSET_NAME);
  if (!metadataAsset || !bundleAsset) {
    return NextResponse.json({ error: "release is missing expected assets" }, { status: 400 });
  }

  let metadata: DatasetMetadata;
  let activeModel: Awaited<ReturnType<typeof getActiveModelTag>>;
  let compatible: boolean;
  let decrypted: Buffer;
  try {
    const metadataBytes = await downloadReleaseAsset(metadataAsset.url, token);
    metadata = JSON.parse(decryptBuffer(metadataBytes, DATASET_SHARED_KEY).toString("utf8")) as DatasetMetadata;

    activeModel = await getActiveModelTag();
    compatible = isCompatible(metadata.model, activeModel);
  } catch (err) {
    // Malformed/tampered metadata ciphertext or JSON — an attacker-reachable
    // failure (the release comes from a repo this instance doesn't own), so
    // it must map to a clean 400, not an unhandled 500.
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  if (!compatible && !body.forceInstall) {
    return NextResponse.json({ compatible: false, datasetModel: metadata.model, activeModel }, { status: 409 });
  }

  let zip: JSZip;
  let manifest;
  try {
    const bundleBytes = await downloadReleaseAsset(bundleAsset.url, token);
    decrypted = decryptBuffer(bundleBytes, DATASET_SHARED_KEY);
    assertCompressedSizeWithinLimit(decrypted.length);

    zip = await JSZip.loadAsync(decrypted);
    assertFileCountWithinLimit(Object.keys(zip.files).length);
    const manifestFile = zip.file("manifest.json");
    if (!manifestFile) throw new Error("manifest.json missing from bundle");
    manifest = validateDatasetManifest(JSON.parse(await manifestFile.async("string")), KNOWN_MODEL_IDS);
    if (manifest.areas.length !== 1) {
      // enqueueEmbedPendingImagesJob/the response below only carry a single
      // areaId — silently keeping only the last area's id would drop earlier
      // areas' data on the floor. No publisher produces multi-area bundles
      // today (POST /api/datasets/publish always zips exactly one area), so
      // fail loudly rather than accept one we can't handle correctly yet.
      throw new Error(`expected exactly 1 area in the bundle, got ${manifest.areas.length}`);
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  const stagingDir = await mkdtemp(join(tmpdir(), "lumi-dataset-"));
  const stagedImages: { panoId: string; heading: number; bytes: Buffer }[] = [];
  let decompressedTotal = 0;

  try {
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
      const { rows } = await getPool().query(
        `INSERT INTO areas (name, geometry, area_km2, status, points_estimated, points_captured,
                            points_failed, images_embedded, estimated_cost_usd, actual_cost_usd)
         VALUES ($1, ST_GeomFromText($2, 4326), $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          area.name, area.geometryWkt, area.areaKm2,
          compatible ? area.status : "pending",
          area.pointsEstimated, area.pointsCaptured, area.pointsFailed,
          compatible ? area.imagesEmbedded : 0,
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
        const embeddingLiteral = compatible && img.embedding ? `[${img.embedding.join(",")}]` : null;
        await getPool().query(
          `INSERT INTO indexed_images (area_id, pano_id, heading, location, street_view_date, embedding, image_path, embedded_at)
           VALUES ($1, $2, $3, ST_GeogFromText($4), $5, $6, $7, CASE WHEN $6 IS NOT NULL THEN now() ELSE NULL END)
           ON CONFLICT (pano_id, heading) DO NOTHING`,
          [areaId, img.panoId, img.heading, `POINT(${img.lng} ${img.lat})`, img.streetViewDate, embeddingLiteral, imagePath]
        );
      }

      for (const pt of area.points) {
        const embeddingLiteral = compatible && pt.embedding ? `[${pt.embedding.join(",")}]` : null;
        await getPool().query(
          `INSERT INTO indexed_points (area_id, pano_id, location, embedding)
           VALUES ($1, $2, ST_GeogFromText($3), $4)
           ON CONFLICT (pano_id) DO NOTHING`,
          [areaId, pt.panoId, `POINT(${pt.lng} ${pt.lat})`, embeddingLiteral]
        );
      }
    }

    if (!compatible) {
      await enqueueEmbedPendingImagesJob({ areaId });
    }

    return NextResponse.json({ areaId, compatible }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}
