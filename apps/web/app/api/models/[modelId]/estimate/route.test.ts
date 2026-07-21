// apps/web/app/api/models/[modelId]/estimate/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

vi.mock("../../../../../lib/db", () => ({ getPool: vi.fn(() => ({})) }));
vi.mock("../../../../../lib/settings-repo", () => ({
  getSettingsRepo: vi.fn(() => ({ getSetting: vi.fn().mockResolvedValue("lumi-preview") })),
}));
vi.mock("../../../../../lib/search/run-search", () => ({ runSearch: vi.fn() }));
vi.mock("../../../../../lib/model-catalog/classification-models", () => ({ findActiveModelForFacet: vi.fn() }));
vi.mock("../../../../../lib/inference-client", () => ({
  embedQueryImage: vi.fn(),
  classifyQueryImage: vi.fn(),
}));

beforeEach(async () => {
  vi.clearAllMocks();
  // clearAllMocks() clears call history but NOT a mockReturnValue set by an
  // earlier test — re-establish the default active model here so the 409
  // test's override (below) can't leak into later tests.
  const { getSettingsRepo } = await import("../../../../../lib/settings-repo");
  (getSettingsRepo as any).mockReturnValue({ getSetting: vi.fn().mockResolvedValue("lumi-preview") });
  const { findActiveModelForFacet } = await import("../../../../../lib/model-catalog/classification-models");
  (findActiveModelForFacet as any).mockResolvedValue(null);
});

function makeRequest(form: FormData) {
  return new Request("http://localhost/api/models/lumi-preview/estimate", { method: "POST", body: form });
}

async function makeJpegBytes(): Promise<Buffer> {
  return sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 128, g: 128, b: 128 } },
  }).jpeg().toBuffer();
}

describe("POST /api/models/[modelId]/estimate", () => {
  it("404s on an unknown modelId, never calling runSearch", async () => {
    const { runSearch } = await import("../../../../../lib/search/run-search");
    const { POST } = await import("./route");

    const form = new FormData();
    const jpegBytes = await makeJpegBytes();
    form.append("image", new File([jpegBytes as unknown as BlobPart], "a.jpg", { type: "image/jpeg" }));
    const res = await POST(makeRequest(form), { params: { modelId: "nonexistent-model" } });

    expect(res.status).toBe(404);
    expect(runSearch).not.toHaveBeenCalled();
  });

  it("409s when modelId is known but not the active model", async () => {
    const { getSettingsRepo } = await import("../../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ getSetting: vi.fn().mockResolvedValue("some-other-active-model") });

    const { POST } = await import("./route");
    const form = new FormData();
    const jpegBytes = await makeJpegBytes();
    form.append("image", new File([jpegBytes as unknown as BlobPart], "a.jpg", { type: "image/jpeg" }));
    const res = await POST(makeRequest(form), { params: { modelId: "lumi-preview" } });

    expect(res.status).toBe(409);
  });

  it("runs the search and returns its result when modelId matches the active model", async () => {
    const { runSearch } = await import("../../../../../lib/search/run-search");
    (runSearch as any).mockResolvedValue({ searchId: "s1", regions: [], candidatesByRegion: {} });

    const { POST } = await import("./route");
    const form = new FormData();
    const jpegBytes = await makeJpegBytes();
    form.append("image", new File([jpegBytes as unknown as BlobPart], "a.jpg", { type: "image/jpeg" }));
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
  it("passes a classifyTimeOfDay dep to runSearch when an active model serves the time_of_day facet", async () => {
    const { runSearch } = await import("../../../../../lib/search/run-search");
    (runSearch as any).mockResolvedValue({ searchId: "s1", regions: [], candidatesByRegion: {}, timeOfDay: null });
    const { findActiveModelForFacet } = await import("../../../../../lib/model-catalog/classification-models");
    (findActiveModelForFacet as any).mockResolvedValue({ modelId: "wanda-v1" });

    const { POST } = await import("./route");
    const form = new FormData();
    const jpegBytes = await makeJpegBytes();
    form.append("image", new File([jpegBytes as unknown as BlobPart], "a.jpg", { type: "image/jpeg" }));
    await POST(makeRequest(form), { params: { modelId: "lumi-preview" } });

    expect(findActiveModelForFacet).toHaveBeenCalledWith(expect.anything(), "time_of_day");
    const depsPassed = (runSearch as any).mock.calls[0][0];
    expect(depsPassed.classifyTimeOfDay).toBeInstanceOf(Function);
  });

  it("omits classifyTimeOfDay entirely when no active model serves the facet", async () => {
    const { runSearch } = await import("../../../../../lib/search/run-search");
    (runSearch as any).mockResolvedValue({ searchId: "s1", regions: [], candidatesByRegion: {}, timeOfDay: null });
    const { findActiveModelForFacet } = await import("../../../../../lib/model-catalog/classification-models");
    (findActiveModelForFacet as any).mockResolvedValue(null);

    const { POST } = await import("./route");
    const form = new FormData();
    const jpegBytes = await makeJpegBytes();
    form.append("image", new File([jpegBytes as unknown as BlobPart], "a.jpg", { type: "image/jpeg" }));
    await POST(makeRequest(form), { params: { modelId: "lumi-preview" } });

    const depsPassed = (runSearch as any).mock.calls[0][0];
    expect(depsPassed.classifyTimeOfDay).toBeUndefined();
  });

  it("classifyTimeOfDay dep resolves to the top time_of_day label and never rejects on classify failure", async () => {
    const { runSearch } = await import("../../../../../lib/search/run-search");
    (runSearch as any).mockResolvedValue({ searchId: "s1", regions: [], candidatesByRegion: {}, timeOfDay: null });
    const { findActiveModelForFacet } = await import("../../../../../lib/model-catalog/classification-models");
    (findActiveModelForFacet as any).mockResolvedValue({ modelId: "wanda-v1" });
    const { classifyQueryImage } = await import("../../../../../lib/inference-client");

    const { POST } = await import("./route");
    const form = new FormData();
    const jpegBytes = await makeJpegBytes();
    form.append("image", new File([jpegBytes as unknown as BlobPart], "a.jpg", { type: "image/jpeg" }));
    await POST(makeRequest(form), { params: { modelId: "lumi-preview" } });

    const depsPassed = (runSearch as any).mock.calls[0][0];

    (classifyQueryImage as any).mockResolvedValue([
      { facet: "time_of_day", labels: [{ name: "foto tomada al mediodía", score: 0.72 }, { name: "foto tomada de noche", score: 0.1 }] },
    ]);
    await expect(depsPassed.classifyTimeOfDay("aaaa")).resolves.toEqual({ label: "foto tomada al mediodía", score: 0.72 });

    (classifyQueryImage as any).mockRejectedValue(new Error("inference service down"));
    await expect(depsPassed.classifyTimeOfDay("aaaa")).resolves.toBeNull();
  });
});
