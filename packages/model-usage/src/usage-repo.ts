// packages/model-usage/src/usage-repo.ts
import type { Pool } from "pg";

export interface ModelUsageSummaryRow {
  kind: string;
  totalCalls: number;
  totalDurationMs: number;
  rateUsdPerHour: number;
  estimatedCostUsd: number;
}

/**
 * Adds one call's duration to today's (date, kind) row, creating it if
 * absent — same daily-aggregate shape as packages/api-usage's
 * recordStreetViewUsage. Also ensures model_usage_rates has a row for
 * this kind (defaulting to a $0/hour rate) so the Settings UI can list
 * every kind ever seen without needing a hardcoded model list.
 */
export async function recordModelUsage(pool: Pool, kind: string, durationMs: number): Promise<void> {
  if (durationMs <= 0) return;
  await pool.query(
    `INSERT INTO model_usage (date, kind, call_count, total_duration_ms)
     VALUES (current_date, $1, 1, $2)
     ON CONFLICT (date, kind) DO UPDATE
       SET call_count = model_usage.call_count + 1,
           total_duration_ms = model_usage.total_duration_ms + $2`,
    [kind, Math.round(durationMs)]
  );
  await pool.query(
    `INSERT INTO model_usage_rates (kind, rate_usd_per_hour)
     VALUES ($1, 0)
     ON CONFLICT (kind) DO NOTHING`,
    [kind]
  );
}

/** All-time summary per kind, joined against its configured rate. */
export async function getModelUsageSummary(pool: Pool): Promise<ModelUsageSummaryRow[]> {
  const { rows } = await pool.query(
    `SELECT
       u.kind AS kind,
       SUM(u.call_count)::bigint AS total_calls,
       SUM(u.total_duration_ms)::bigint AS total_duration_ms,
       COALESCE(r.rate_usd_per_hour, 0) AS rate_usd_per_hour,
       (SUM(u.total_duration_ms)::numeric / 3600000) * COALESCE(r.rate_usd_per_hour, 0) AS estimated_cost_usd
     FROM model_usage u
     LEFT JOIN model_usage_rates r ON r.kind = u.kind
     GROUP BY u.kind, r.rate_usd_per_hour
     ORDER BY u.kind`
  );
  return rows.map((row) => ({
    kind: row.kind as string,
    totalCalls: Number(row.total_calls),
    totalDurationMs: Number(row.total_duration_ms),
    rateUsdPerHour: Number(row.rate_usd_per_hour),
    estimatedCostUsd: Number(row.estimated_cost_usd),
  }));
}

/** Upserts the $/hour rate for one kind (called from the Settings UI). */
export async function setModelUsageRate(pool: Pool, kind: string, rateUsdPerHour: number): Promise<void> {
  await pool.query(
    `INSERT INTO model_usage_rates (kind, rate_usd_per_hour)
     VALUES ($1, $2)
     ON CONFLICT (kind) DO UPDATE SET rate_usd_per_hour = $2`,
    [kind, rateUsdPerHour]
  );
}
