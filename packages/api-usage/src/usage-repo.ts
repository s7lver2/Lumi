// packages/api-usage/src/usage-repo.ts
import type { Pool } from "pg";

/**
 * Adds `requests` served images (and their cost) to today's api_usage row,
 * creating it if absent (spec §12.3). One row per calendar day (UNIQUE date).
 */
export async function recordStreetViewUsage(
  pool: Pool,
  requests: number,
  pricePerImageUsd: number
): Promise<void> {
  if (requests <= 0) return;
  const costUsd = requests * pricePerImageUsd;
  await pool.query(
    `INSERT INTO api_usage (date, street_view_requests, estimated_cost_usd)
     VALUES (current_date, $1, $2)
     ON CONFLICT (date) DO UPDATE
       SET street_view_requests = api_usage.street_view_requests + $1,
           estimated_cost_usd = api_usage.estimated_cost_usd + $2`,
    [requests, costUsd]
  );
}

/** Month-to-date Street View spend in USD (spec §12.2). */
export async function getMonthlySpendUsd(pool: Pool): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS spent
     FROM api_usage WHERE date >= date_trunc('month', current_date)`
  );
  return Number(rows[0].spent);
}