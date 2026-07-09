// apps/worker/src/index.ts
import { config } from "dotenv";
import { resolve } from "node:path";
import { saveCaptureImage } from "./image-store";



// This worker has its own package cwd (apps/worker) and, unlike apps/web,
// nothing auto-loads env files for a plain tsx/node process. apps/web and
// apps/worker must read the SAME root .env so SETTINGS_KEY_PATH resolves
// to the same absolute path in both (spec §14.4) — see also
// db/package.json's `--envPath ../.env` for the same convention.
config({ path: resolve(import.meta.dirname, "../../../.env") });

import type { IndexAreaJobPayload } from "@netryx/shared-types";
import { getBoss, INDEX_AREA_JOB_NAME } from "./queue";
import { getPool } from "./db";
import { getSettingsRepo } from "./settings";
import { runIndexAreaJob } from "./jobs/index-area";
import { downloadCaptures } from "./street-view";
import { embedImages } from "./inference-client";
import { updateAreaProgress, loadExistingPanoHeadings } from "./progress";
import { fetchStreetGeometry, samplePointsAlongStreets } from "@netryx/geo-sampling";
import { getArea, getAreaPolygon, insertIndexedImages, insertIndexedPoints } from "./db-queries";

function isIndexAreaJobPayload(data: unknown): data is IndexAreaJobPayload {
  return (
    typeof data === "object" &&
    data !== null &&
    "areaId" in data &&
    typeof (data as { areaId: unknown }).areaId === "string"
  );
}

async function main() {
  const pool = getPool();
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
      samplePointsAlongStreets: (lines, spacing) => samplePointsAlongStreets(lines, spacing),
      loadExistingPanoHeadings: () => loadExistingPanoHeadings(pool),
      downloadCaptures,
      embedImages,
      insertIndexedImages: (areaId, images) => insertIndexedImages(pool, areaId, images),
      updateAreaProgress: (areaId, update) => updateAreaProgress(pool, areaId, update),
      getSetting: (key) => settingsRepo.getSetting(key),
      inferenceBaseUrl,
      insertIndexedPoints: (areaId, points) => insertIndexedPoints(pool, areaId, points),
      saveCaptureImage: (panoId, heading, base64) => saveCaptureImage(panoId, heading, base64),
    });
  });
  console.log(`netryx worker listening for "${INDEX_AREA_JOB_NAME}" jobs`);
}

main().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});