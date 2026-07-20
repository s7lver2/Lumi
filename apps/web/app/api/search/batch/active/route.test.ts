// apps/web/app/api/search/batch/active/route.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../../lib/db", () => ({ getPool: vi.fn() }));

describe("GET /api/search/batch/active", () => {
  it("returns the most recent non-terminal batch", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ id: "batch-1", status: "running", total: 5, done: 2, failed: 0 }],
    });
    const { getPool } = await import("../../../../../lib/db");
    (getPool as any).mockReturnValue({ query });

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.batch).toEqual({ id: "batch-1", status: "running", total: 5, done: 2, failed: 0 });
    expect(query.mock.calls[0][0]).toContain("status IN ('pending', 'running')");
  });

  it("returns { batch: null } when nothing is in flight", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const { getPool } = await import("../../../../../lib/db");
    (getPool as any).mockReturnValue({ query });

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(json.batch).toBeNull();
  });
});