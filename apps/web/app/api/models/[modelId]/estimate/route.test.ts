// apps/web/app/api/models/[modelId]/estimate/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../lib/db", () => ({ getPool: vi.fn(() => ({})) }));
vi.mock("../../../../../lib/settings-repo", () => ({
  getSettingsRepo: vi.fn(() => ({ getSetting: vi.fn().mockResolvedValue("lumi-preview") })),
}));
vi.mock("../../../../../lib/search/run-search", () => ({ runSearch: vi.fn() }));

beforeEach(async () => {
  vi.clearAllMocks();
  // clearAllMocks() clears call history but NOT a mockReturnValue set by an
  // earlier test — re-establish the default active model here so the 409
  // test's override (below) can't leak into later tests.
  const { getSettingsRepo } = await import("../../../../../lib/settings-repo");
  (getSettingsRepo as any).mockReturnValue({ getSetting: vi.fn().mockResolvedValue("lumi-preview") });
});

function makeRequest(form: FormData) {
  return new Request("http://localhost/api/models/lumi-preview/estimate", { method: "POST", body: form });
}

describe("POST /api/models/[modelId]/estimate", () => {
  it("404s on an unknown modelId, never calling runSearch", async () => {
    const { runSearch } = await import("../../../../../lib/search/run-search");
    const { POST } = await import("./route");

    const form = new FormData();
    form.append("image", new File([new Uint8Array([1])], "a.jpg"));
    const res = await POST(makeRequest(form), { params: { modelId: "nonexistent-model" } });

    expect(res.status).toBe(404);
    expect(runSearch).not.toHaveBeenCalled();
  });

  it("409s when modelId is known but not the active model", async () => {
    const { getSettingsRepo } = await import("../../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ getSetting: vi.fn().mockResolvedValue("some-other-active-model") });

    const { POST } = await import("./route");
    const form = new FormData();
    form.append("image", new File([new Uint8Array([1])], "a.jpg"));
    const res = await POST(makeRequest(form), { params: { modelId: "lumi-preview" } });

    expect(res.status).toBe(409);
  });

  it("runs the search and returns its result when modelId matches the active model", async () => {
    const { runSearch } = await import("../../../../../lib/search/run-search");
    (runSearch as any).mockResolvedValue({ searchId: "s1", regions: [], candidatesByRegion: {} });

    const { POST } = await import("./route");
    const form = new FormData();
    form.append("image", new File([new Uint8Array([1])], "a.jpg"));
    const res = await POST(makeRequest(form), { params: { modelId: "lumi-preview" } });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.searchId).toBe("s1");
  });

  it("400s when no image field is present", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest(new FormData()), { params: { modelId: "lumi-preview" } });
    expect(res.status).toBe(400);
  });
});
