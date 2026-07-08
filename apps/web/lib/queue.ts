import PgBoss from "pg-boss";
import { INDEX_AREA_JOB_NAME, type IndexAreaJobPayload } from "@netryx/shared-types";

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