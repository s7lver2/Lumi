import PgBoss from "pg-boss";
import {
  INDEX_AREA_JOB_NAME,
  EMBED_PENDING_IMAGES_JOB_NAME,
  ANALYZE_IMAGE_BATCH_JOB_NAME,
  type IndexAreaJobPayload,
  type EmbedPendingImagesJobPayload,
  type AnalyzeImageBatchJobPayload,
} from "@netryx/shared-types";

let boss: PgBoss | undefined;

/**
 * Inicializa y arranca la instancia de pg-boss como productor (orquestador de colas).
 * Mantiene el aislamiento de responsabilidades: la app web solo encola tareas mediante .send(),
 * delegando la ejecución (.work()) exclusivamente al proceso del worker.
 */
async function getBoss(): Promise<PgBoss> {
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

/**
 * Encola un nuevo trabajo pg-boss para procesar e indexar un área geográfica.
 * * @param payload Objeto que contiene el identificador único del área (`areaId`).
 * @returns El identificador del trabajo generado por pg-boss.
 */
export async function enqueueIndexAreaJob(payload: IndexAreaJobPayload): Promise<string> {
  const client = await getBoss();
  const jobId = await client.send(INDEX_AREA_JOB_NAME, payload);
  
  if (!jobId) {
    throw new Error(`pg-boss declined to enqueue the ${INDEX_AREA_JOB_NAME} job`);
  }

  return jobId;
}

/** Enqueued after a dataset install whose release didn't match the locally
 * active model (spec: "Completing embeddings after a mismatched install") —
 * see apps/worker/src/jobs/embed-pending-images.ts for what the worker
 * actually does with it. */
export async function enqueueEmbedPendingImagesJob(payload: EmbedPendingImagesJobPayload): Promise<string> {
  const client = await getBoss();
  const jobId = await client.send(EMBED_PENDING_IMAGES_JOB_NAME, payload);

  if (!jobId) {
    throw new Error(`pg-boss declined to enqueue the ${EMBED_PENDING_IMAGES_JOB_NAME} job`);
  }

  return jobId;
}

export async function enqueueAnalyzeImageBatchJob(payload: AnalyzeImageBatchJobPayload): Promise<string> {
  const client = await getBoss();
  const jobId = await client.send(ANALYZE_IMAGE_BATCH_JOB_NAME, payload);

  if (!jobId) {
    throw new Error(`pg-boss declined to enqueue the ${ANALYZE_IMAGE_BATCH_JOB_NAME} job`);
  }

  return jobId;
}