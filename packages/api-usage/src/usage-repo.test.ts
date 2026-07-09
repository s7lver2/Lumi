// packages/api-usage/src/usage-repo.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { recordStreetViewUsage, getMonthlySpendUsd } from "./usage-repo";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("usage-repo", () => {
  const pool = new Pool({ connectionString: url });

  beforeEach(async () => {
    // isolate: clear today's/this month's rows created by prior runs
    await pool.query(`DELETE FROM api_usage WHERE date >= date_trunc('month', current_date)`);
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM api_usage WHERE date >= date_trunc('month', current_date)`);
    await pool.end();
  });

  it("upserts today's row, accumulating requests and cost", async () => {
    await recordStreetViewUsage(pool, 100, 0.007);
    await recordStreetViewUsage(pool, 50, 0.007);
    const { rows } = await pool.query(
      `SELECT street_view_requests, estimated_cost_usd FROM api_usage WHERE date = current_date`
    );
    expect(rows[0].street_view_requests).toBe(150);
    expect(Number(rows[0].estimated_cost_usd)).toBeCloseTo(1.05, 5); // 150 * 0.007
  });

  it("sums month-to-date spend", async () => {
    await recordStreetViewUsage(pool, 200, 0.007);
    expect(await getMonthlySpendUsd(pool)).toBeCloseTo(1.4, 5); // 200 * 0.007
  });
});