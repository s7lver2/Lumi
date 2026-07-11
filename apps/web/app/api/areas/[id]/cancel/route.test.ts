// apps/web/app/api/areas/[id]/cancel/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const areas: Record<string, { status: string }> = {};

vi.mock("../../../../../lib/db", () => ({
  getPool: () => ({
    query: vi.fn(async (sql: string, params: any[]) => {
      if (sql.includes("SELECT status FROM areas")) {
        const row = areas[params[0]];
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("UPDATE areas SET status = 'cancelled'")) {
        if (areas[params[0]]) areas[params[0]].status = "cancelled";
        return { rows: [] };
      }
      return { rows: [] };
    }),
  }),
}));

import { POST } from "./route";

beforeEach(() => {
  for (const k of Object.keys(areas)) delete areas[k];
});

function makeRequest() {
  return new Request("http://localhost/api/areas/a1/cancel", { method: "POST" });
}

describe("POST /api/areas/:id/cancel", () => {
  it("returns 404 when the area doesn't exist", async () => {
    const res = await POST(makeRequest(), { params: { id: "missing" } });
    expect(res.status).toBe(404);
  });

  it("cancels a pending area", async () => {
    areas["a1"] = { status: "pending" };
    const res = await POST(makeRequest(), { params: { id: "a1" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("cancelled");
    expect(areas["a1"].status).toBe("cancelled");
  });

  it("cancels an indexing area", async () => {
    areas["a1"] = { status: "indexing" };
    const res = await POST(makeRequest(), { params: { id: "a1" } });
    expect(res.status).toBe(200);
    expect(areas["a1"].status).toBe("cancelled");
  });

  it("rejects cancelling an already-indexed area with 409", async () => {
    areas["a1"] = { status: "indexed" };
    const res = await POST(makeRequest(), { params: { id: "a1" } });
    expect(res.status).toBe(409);
    expect(areas["a1"].status).toBe("indexed");
  });

  it("rejects cancelling an already-cancelled area with 409", async () => {
    areas["a1"] = { status: "cancelled" };
    const res = await POST(makeRequest(), { params: { id: "a1" } });
    expect(res.status).toBe(409);
  });
});
