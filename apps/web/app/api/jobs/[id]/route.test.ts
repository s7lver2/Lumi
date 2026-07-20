// apps/web/app/api/jobs/[id]/route.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../lib/db", () => ({ getPool: vi.fn(() => ({})) }));
vi.mock("../../../../lib/background-jobs", () => ({ getJob: vi.fn() }));

function makeRequest() {
  return new Request("http://localhost/api/jobs/job-1");
}

describe("GET /api/jobs/[id]", () => {
  it("returns the job when it exists", async () => {
    const { getJob } = await import("../../../../lib/background-jobs");
    (getJob as any).mockResolvedValue({
      id: "job-1", kind: "model-install", label: "Wanda v1.0", status: "done",
      error: null, result: { ok: true }, createdAt: "x", updatedAt: "x",
    });

    const { GET } = await import("./route");
    const res = await GET(makeRequest(), { params: { id: "job-1" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.id).toBe("job-1");
  });

  it("404s when the job doesn't exist", async () => {
    const { getJob } = await import("../../../../lib/background-jobs");
    (getJob as any).mockResolvedValue(null);

    const { GET } = await import("./route");
    const res = await GET(makeRequest(), { params: { id: "missing" } });
    expect(res.status).toBe(404);
  });
});