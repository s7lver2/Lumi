// apps/worker/src/progress.ts
import type { Pool } from "pg";
import type { AreaStatus } from "@netryx/shared-types";

export interface AreaProgressUpdate {
  status?: AreaStatus;
  pointsEstimated?: number;
  pointsCaptured?: number;
  pointsFailed?: number;
  imagesEmbedded?: number;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
}

const COLUMN_MAP: Record<keyof AreaProgressUpdate, string> = {
  status: "status",
  pointsEstimated: "points_estimated",
  pointsCaptured: "points_captured",
  pointsFailed: "points_failed",
  imagesEmbedded: "images_embedded",
  estimatedCostUsd: "estimated_cost_usd",
  actualCostUsd: "actual_cost_usd",
};

/** Writes only the provided fields onto the areas row — this is what /api/areas/:id/progress (Task 15) polls. */
export async function updateAreaProgress(
  pool: Pool,
  areaId: string,
  update: AreaProgressUpdate
): Promise<void> {
  const entries = Object.entries(update) as [keyof AreaProgressUpdate, unknown][];
  if (entries.length === 0) return;

  const setClauses = entries.map(([key], i) => `${COLUMN_MAP[key]} = $${i + 2}`);
  const values = entries.map(([, value]) => value);

  await pool.query(
    `UPDATE areas SET ${setClauses.join(", ")}, updated_at = now() WHERE id = $1`,
    [areaId, ...values]
  );
}

/** Global dedupe set: which pano_id/heading pairs are already indexed, across ALL areas (spec §4 step 4). */
export async function loadExistingPanoHeadings(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ pano_id: string; heading: number }>(
    "SELECT pano_id, heading FROM indexed_images"
  );
  return new Set(rows.map((r) => `${r.pano_id}:${r.heading}`));
}