// apps/web/lib/search/batch-phase.ts
import type { Pool } from "pg";

export type BatchPhase = "embedding" | "searching" | "saving";

/** Reports which coarse phase of a single in-flight batch photo's analysis
 * is currently running — surfaced by the "Escaneando X/Y…" notification
 * (spec: docs/superpowers/specs/2026-07-21-weather-classifier-and-batch-
 * phase-design.md). Only ever called for a search that's part of a batch
 * (see the estimate route's optional batchId handling) — a direct UI
 * search never calls this at all. */
export async function reportBatchPhase(pool: Pool, batchId: string, phase: BatchPhase): Promise<void> {
  await pool.query(
    `UPDATE search_batches SET current_phase = $2, updated_at = now() WHERE id = $1`,
    [batchId, phase]
  );
}