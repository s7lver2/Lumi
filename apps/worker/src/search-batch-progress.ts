// apps/worker/src/search-batch-progress.ts
import type { Pool } from "pg";

export interface SearchBatchProgressUpdate {
  status?: "pending" | "running" | "done" | "failed";
  done?: number;
  failed?: number;
}

const COLUMN_MAP: Record<keyof SearchBatchProgressUpdate, string> = {
  status: "status",
  done: "done",
  failed: "failed",
};

/** Writes only the provided fields onto the search_batches row — polled by
 * GET /api/search/batch/:batchId/progress (Task 11). */
export async function updateSearchBatchProgress(
  pool: Pool,
  batchId: string,
  update: SearchBatchProgressUpdate
): Promise<void> {
  const entries = Object.entries(update) as [keyof SearchBatchProgressUpdate, unknown][];
  if (entries.length === 0) return;

  const setClauses = entries.map(([key], i) => `${COLUMN_MAP[key]} = $${i + 2}`);
  const values = entries.map(([, value]) => value);

  await pool.query(
    `UPDATE search_batches SET ${setClauses.join(", ")}, updated_at = now() WHERE id = $1`,
    [batchId, ...values]
  );
}