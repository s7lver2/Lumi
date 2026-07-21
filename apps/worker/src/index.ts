// apps/worker/src/index.ts
import { config } from "dotenv";
import { resolve } from "node:path";
import { saveCaptureImage } from "./image-store";
import { getMonthlySpendUsd, recordStreetViewUsage } from "@netryx/api-usage";
import type { AnalyzeImageBatchJobPayload } from "@netryx/shared-types";
import { runAnalyzeImageBatchJob } from "./jobs/analyze-image-batch";
import { updateSearchBatchProgress } from "./search-batch-progress";

// This worker has its own package cwd (apps/worker) and, unlike apps/web,
// nothing auto-loads env files for a plain tsx/node process. apps/web and
// apps/worker must read the SAME root .env so SETTINGS_KEY_PATH resolves
// to the same absolute path in both (spec §14.4) — see also
// db/package.json's `--envPath ../.env` for the same convention.
// FIX: Se cambia 'import.meta.dirname' por el estándar de CommonJS '__dirname'
config({ path: resolve(__dirname, "../../../.env") });

import type { IndexAreaJobPayload, EmbedPendingImagesJobPayload } from "@netryx/shared-types";
import { getBoss, INDEX_AREA_JOB_NAME, EMBED_PENDING_IMAGES_JOB_NAME, ANALYZE_IMAGE_BATCH_JOB_NAME } from "./queue";
import { getPool } from "./db";
import { startHeartbeatLoop } from "./heartbeat";
import { getSettingsRepo } from "./settings";
import { runIndexAreaJob } from "./jobs/index-area";
import { runEmbedPendingImagesJob } from "./jobs/embed-pending-images";
import { downloadCaptures } from "./street-view";
import { embedImages } from "./inference-client";
import { updateAreaProgress, loadExistingPanoHeadings } from "./progress";
import { fetchStreetGeometry, samplePointsAlongStreets } from "@netryx/geo-sampling";
import {
  getArea,
  getAreaPolygon,
  insertIndexedImages,
  insertIndexedPoints,
  isAreaCancelled,
  getPendingEmbedImages,
  updateImageEmbeddings,
} from "./db-queries";
import { readFile } from "node:fs/promises";

function isIndexAreaJobPayload(data: unknown): data is IndexAreaJobPayload {
  return (
    typeof data === "object" &&
    data !== null &&
    "areaId" in data &&
    typeof (data as { areaId: unknown }).areaId === "string"
  );
}

function isAnalyzeImageBatchJobPayload(data: unknown): data is AnalyzeImageBatchJobPayload {
  return (
    typeof data === "object" &&
    data !== null &&
    "batchId" in data &&
    "imageIds" in data &&
    "modelId" in data &&
    Array.isArray((data as { imageIds: unknown }).imageIds)
  );
}

function isEmbedPendingImagesJobPayload(data: unknown): data is EmbedPendingImagesJobPayload {
  return (
    typeof data === "object" &&
    data !== null &&
    "areaId" in data &&
    typeof (data as { areaId: unknown }).areaId === "string"
  );
}

async function main() {
  const pool = getPool();
  startHeartbeatLoop(pool);
  const settingsRepo = getSettingsRepo();
  const boss = await getBoss();
  const inferenceBaseUrl = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";
  await boss.work(INDEX_AREA_JOB_NAME, async (job) => {
    if (!isIndexAreaJobPayload(job.data)) {
      throw new Error(`Malformed ${INDEX_AREA_JOB_NAME} payload: ${JSON.stringify(job.data)}`);
    }

    await runIndexAreaJob(job.data, {
      getArea: (id) => getArea(pool, id),
      getAreaPolygon: (id) => getAreaPolygon(pool, id),
      fetchStreetGeometry,
      samplePointsAlongStreets: (lines, spacing, polygon) => samplePointsAlongStreets(lines, spacing, polygon),
      loadExistingPanoHeadings: () => loadExistingPanoHeadings(pool),
      downloadCaptures,
      embedImages,
      insertIndexedImages: (areaId, images) => insertIndexedImages(pool, areaId, images),
      updateAreaProgress: (areaId, update) => updateAreaProgress(pool, areaId, update),
      getSetting: (key) => settingsRepo.getSetting(key),
      inferenceBaseUrl,
      insertIndexedPoints: (areaId, points) => insertIndexedPoints(pool, areaId, points),
      saveCaptureImage: (panoId, heading, base64) => saveCaptureImage(panoId, heading, base64),
      getMonthlySpendUsd: () => getMonthlySpendUsd(pool),
      recordStreetViewUsage: (requests, price) => recordStreetViewUsage(pool, requests, price),
      isCancelled: (areaId) => isAreaCancelled(pool, areaId),
    });
  });
  await boss.work(ANALYZE_IMAGE_BATCH_JOB_NAME, async (job) => {
    if (!isAnalyzeImageBatchJobPayload(job.data)) {
      throw new Error(`Malformed ${ANALYZE_IMAGE_BATCH_JOB_NAME} payload: ${JSON.stringify(job.data)}`);
    }
    const webBaseUrl = process.env.WEB_APP_URL ?? "http://localhost:3000";
    await runAnalyzeImageBatchJob(job.data, {
      getImageBytes: async (imageId) => {
        const res = await fetch(`${webBaseUrl}/api/library/${imageId}/bytes`);
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
      },
      analyzeOne: async (imageBytes, modelId, batchId) => {
        const form = new FormData();
        form.append("image", new Blob([imageBytes as unknown as BlobPart]), "batch-image");
        form.append("batchId", batchId);
        const res = await fetch(`${webBaseUrl}/api/models/${modelId}/estimate`, { method: "POST", body: form });
        if (!res.ok) throw new Error(`estimate failed with status ${res.status}`);
        return res.json();
      },
      updateProgress: (batchId, update) => updateSearchBatchProgress(pool, batchId, update),
    });
  });
  await boss.work(EMBED_PENDING_IMAGES_JOB_NAME, async (job) => {
    if (!isEmbedPendingImagesJobPayload(job.data)) {
      throw new Error(`Malformed ${EMBED_PENDING_IMAGES_JOB_NAME} payload: ${JSON.stringify(job.data)}`);
    }
    await runEmbedPendingImagesJob(job.data, {
      getPendingImages: (areaId) => getPendingEmbedImages(pool, areaId),
      readImageBase64: async (imagePath) => (await readFile(imagePath)).toString("base64"),
      embedImages,
      updateImageEmbeddings: (updates) => updateImageEmbeddings(pool, updates),
      updateAreaProgress: (areaId, update) => updateAreaProgress(pool, areaId, update),
      inferenceBaseUrl,
    });
  });
  console.log(`netryx worker listening for "${INDEX_AREA_JOB_NAME}" jobs`);
}

main().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});