// apps/web/lib/search/batch-phase.test.ts
import { describe, it, expect, vi } from "vitest";
import { reportBatchPhase } from "./batch-phase";

function makePool(queryImpl: (sql: string, params: unknown[]) => Promise<{ rows: any[] }>) {
  return { query: vi.fn(queryImpl) } as any;
}

describe("reportBatchPhase", () => {
  it("writes current_phase and bumps updated_at", async () => {
    const pool = makePool(async (sql, params) => {
      expect(sql).toContain("UPDATE search_batches");
      expect(sql).toContain("current_phase = $2");
      expect(params).toEqual(["batch-1", "searching"]);
      return { rows: [] };
    });

    await reportBatchPhase(pool, "batch-1", "searching");
  });
});