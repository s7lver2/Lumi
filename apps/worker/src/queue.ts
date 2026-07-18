// apps/worker/src/queue.ts
import PgBoss from "pg-boss";
import {
  INDEX_AREA_JOB_NAME,
  EMBED_PENDING_IMAGES_JOB_NAME,
  ANALYZE_IMAGE_BATCH_JOB_NAME,
  type IndexAreaJobPayload,
  type EmbedPendingImagesJobPayload,
  type AnalyzeImageBatchJobPayload,
} from "@netryx/shared-types";

export { INDEX_AREA_JOB_NAME, EMBED_PENDING_IMAGES_JOB_NAME, ANALYZE_IMAGE_BATCH_JOB_NAME };
export type { IndexAreaJobPayload, EmbedPendingImagesJobPayload, AnalyzeImageBatchJobPayload };

let boss: PgBoss | undefined;

export async function getBoss(): Promise<PgBoss> {
  if (!boss) {
    boss = new PgBoss({
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
    });
    await boss.start();
  }
  return boss;
}

/** Used by apps/web's POST /api/areas (Task 14) — enqueues and returns instantly. */
export async function enqueueIndexAreaJob(payload: IndexAreaJobPayload): Promise<string> {
  const client = await getBoss();
  const jobId = await client.send(INDEX_AREA_JOB_NAME, payload);
  if (!jobId) {
    throw new Error("pg-boss declined to enqueue the index-area job");
  }
  return jobId;
}