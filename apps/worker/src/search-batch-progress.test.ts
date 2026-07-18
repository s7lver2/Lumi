// apps/worker/src/search-batch-progress.test.ts
import { describe, it, expect, vi } from "vitest";
import { updateSearchBatchProgress } from "./search-batch-progress";

describe("updateSearchBatchProgress", () => {
  it("builds a dynamic SET clause from only the provided fields", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as import("pg").Pool;

    await updateSearchBatchProgress(pool, "batch-1", { status: "running", done: 3 });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE search_batches SET status = $2, done = $3, updated_at = now() WHERE id = $1"),
      ["batch-1", "running", 3]
    );
  });

  it("does nothing when given an empty update", async () => {
    const query = vi.fn();
    const pool = { query } as unknown as import("pg").Pool;

    await updateSearchBatchProgress(pool, "batch-1", {});

    expect(query).not.toHaveBeenCalled();
  });
});