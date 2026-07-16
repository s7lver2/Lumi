// apps/web/app/api/models/[modelId]/refine/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../lib/db", () => ({ getPool: vi.fn(() => ({})) }));
vi.mock("../../../../../lib/settings-repo", () => ({
  getSettingsRepo: vi.fn(() => ({ getSetting: vi.fn().mockResolvedValue("lumi-preview") })),
}));
vi.mock("../../../../../lib/search/run-refine", () => ({ runRefine: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/models/lumi-preview/refine", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readEvents(res: Response) {
  const text = await res.text();
  return text.split("\n\n").filter((c) => c.startsWith("data: ")).map((c) => JSON.parse(c.slice("data: ".length)));
}

describe("POST /api/models/[modelId]/refine", () => {
  it("400s when regionId is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ searchId: "s1" }), { params: { modelId: "lumi-preview" } });
    expect(res.status).toBe(400);
  });

  it("404s on an unknown modelId before touching runRefine", async () => {
    const { runRefine } = await import("../../../../../lib/search/run-refine");
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ searchId: "s1", regionId: "r1" }), { params: { modelId: "nonexistent" } });
    expect(res.status).toBe(404);
    expect(runRefine).not.toHaveBeenCalled();
  });

  it("streams a done event with runRefine's result on success", async () => {
    const { runRefine } = await import("../../../../../lib/search/run-refine");
    (runRefine as any).mockResolvedValue({ searchId: "s1", regionId: "r1", candidates: [] });

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ searchId: "s1", regionId: "r1" }), { params: { modelId: "lumi-preview" } });
    const events = await readEvents(res);

    expect(events.some((e) => e.type === "done" && e.result.searchId === "s1")).toBe(true);
  });
});
