// apps/web/app/api/jobs/route.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../lib/db", () => ({ getPool: vi.fn(() => ({})) }));
vi.mock("../../../lib/background-jobs", () => ({ listActiveJobs: vi.fn() }));

describe("GET /api/jobs", () => {
  it("returns the active jobs list", async () => {
    const { listActiveJobs } = await import("../../../lib/background-jobs");
    (listActiveJobs as any).mockResolvedValue([
      { id: "job-1", kind: "model-install", label: "Wanda v1.0", status: "running", error: null, result: null, createdAt: "x", updatedAt: "x" },
    ]);

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.jobs).toHaveLength(1);
    expect(json.jobs[0].id).toBe("job-1");
  });
});