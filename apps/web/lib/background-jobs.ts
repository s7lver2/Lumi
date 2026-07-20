// apps/web/lib/background-jobs.ts
import type { Pool } from "pg";

export type BackgroundJobKind = "dataset-install" | "model-install" | "model-uninstall";
export type BackgroundJobStatus = "running" | "done" | "failed";

export interface BackgroundJobProgress {
  phase: string;
  current: number;
  total: number | null;
}

export interface BackgroundJob {
  id: string;
  kind: BackgroundJobKind;
  label: string;
  status: BackgroundJobStatus;
  error: string | null;
  result: unknown | null;
  progress: BackgroundJobProgress | null;
  createdAt: string;
  updatedAt: string;
}

interface BackgroundJobRow {
  id: string;
  kind: BackgroundJobKind;
  label: string;
  status: BackgroundJobStatus;
  error: string | null;
  result: unknown | null;
  progress_phase: string | null;
  progress_current: number | null;
  progress_total: number | null;
  created_at: string;
  updated_at: string;
}

function toBackgroundJob(row: BackgroundJobRow): BackgroundJob {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    status: row.status,
    error: row.error,
    result: row.result,
    progress:
      row.progress_phase !== null
        ? { phase: row.progress_phase, current: row.progress_current ?? 0, total: row.progress_total }
        : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createJob(pool: Pool, kind: BackgroundJobKind, label: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO background_jobs (kind, label) VALUES ($1, $2) RETURNING id`,
    [kind, label]
  );
  return rows[0].id as string;
}

export async function completeJob(pool: Pool, id: string, result: unknown): Promise<void> {
  await pool.query(
    `UPDATE background_jobs SET status = 'done', result = $2, updated_at = now() WHERE id = $1`,
    [id, JSON.stringify(result)]
  );
}

export async function failJob(pool: Pool, id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE background_jobs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
    [id, error]
  );
}

/** Reports live progress for a running job — e.g. bytes downloaded so far
 * (`phase: "download"`) or images extracted so far (`phase: "extract"`).
 * `total` is null when it isn't known yet (e.g. a download whose response
 * has no Content-Length header). Callers should throttle how often this
 * gets called (progress can otherwise fire on every network chunk) — this
 * function itself does one unconditional write per call. */
export async function updateJobProgress(
  pool: Pool,
  id: string,
  phase: string,
  current: number,
  total: number | null
): Promise<void> {
  await pool.query(
    `UPDATE background_jobs SET progress_phase = $2, progress_current = $3, progress_total = $4, updated_at = now() WHERE id = $1`,
    [id, phase, current, total]
  );
}

export async function getJob(pool: Pool, id: string): Promise<BackgroundJob | null> {
  const { rows } = await pool.query(`SELECT * FROM background_jobs WHERE id = $1`, [id]);
  if (rows.length === 0) return null;
  return toBackgroundJob(rows[0] as BackgroundJobRow);
}

export async function listActiveJobs(pool: Pool): Promise<BackgroundJob[]> {
  const { rows } = await pool.query(
    `SELECT * FROM background_jobs
     WHERE status = 'running' OR updated_at > now() - interval '15 seconds'
     ORDER BY created_at DESC`
  );
  return (rows as BackgroundJobRow[]).map(toBackgroundJob);
}
