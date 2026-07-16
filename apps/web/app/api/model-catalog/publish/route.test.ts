// apps/web/app/api/model-catalog/publish/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../lib/db", () => ({ getPool: vi.fn(() => ({})) }));
vi.mock("../../../../lib/settings-repo", () => ({ getSettingsRepo: vi.fn() }));
vi.mock("../../../../lib/model-catalog/benchmark", () => ({
  buildReferenceSet: vi.fn(),
  runBenchmark: vi.fn(),
  passesBenchmarkThreshold: vi.fn(),
}));
vi.mock("../../../../lib/model-catalog/code-bundle", () => ({ buildInferenceCodeZip: vi.fn() }));
vi.mock("../../../../lib/model-catalog/github", () => ({ ensureRepoWithTopic: vi.fn(), upsertRelease: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/model-catalog/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/model-catalog/publish", () => {
  it("400s when GITHUB_TOKEN or MODEL_CATALOG_REPO isn't configured", async () => {
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ getSetting: vi.fn().mockResolvedValue(null) });

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ description: "d" }));
    expect(res.status).toBe(400);
  });

  it("409s with the benchmark result when it fails the threshold, uploading nothing", async () => {
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({
      getSetting: vi.fn((key: string) => Promise.resolve(key === "GITHUB_TOKEN" ? "tok" : "inigo/lumi-model-catalog")),
    });
    const { buildReferenceSet, runBenchmark, passesBenchmarkThreshold } = await import("../../../../lib/model-catalog/benchmark");
    (buildReferenceSet as any).mockResolvedValue([{ indexedImageId: "i1", imagePath: "/a.jpg", trueLat: 0, trueLng: 0 }]);
    (runBenchmark as any).mockResolvedValue({ accuracyWithin50m: 0.2, avgDistanceM: 200, sampleCount: 1, ranAt: "x" });
    (passesBenchmarkThreshold as any).mockReturnValue(false);

    const { ensureRepoWithTopic } = await import("../../../../lib/model-catalog/github");
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ description: "d" }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.benchmark.accuracyWithin50m).toBe(0.2);
    expect(ensureRepoWithTopic).not.toHaveBeenCalled();
  });

  it("publishes when the benchmark passes", async () => {
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({
      getSetting: vi.fn((key: string) => Promise.resolve(key === "GITHUB_TOKEN" ? "tok" : "inigo/lumi-model-catalog")),
    });
    const { buildReferenceSet, runBenchmark, passesBenchmarkThreshold } = await import("../../../../lib/model-catalog/benchmark");
    (buildReferenceSet as any).mockResolvedValue([{ indexedImageId: "i1", imagePath: "/a.jpg", trueLat: 0, trueLng: 0 }]);
    (runBenchmark as any).mockResolvedValue({ accuracyWithin50m: 0.9, avgDistanceM: 5, sampleCount: 1, ranAt: "x" });
    (passesBenchmarkThreshold as any).mockReturnValue(true);

    const { buildInferenceCodeZip } = await import("../../../../lib/model-catalog/code-bundle");
    (buildInferenceCodeZip as any).mockResolvedValue(new Uint8Array([1, 2, 3]));

    const { ensureRepoWithTopic, upsertRelease } = await import("../../../../lib/model-catalog/github");

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ description: "Better re-ranking" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.tag).toBe("lumi-preview-v1.0");
    expect(ensureRepoWithTopic).toHaveBeenCalledWith("inigo", "lumi-model-catalog", "tok");
    expect(upsertRelease).toHaveBeenCalledWith(
      "inigo", "lumi-model-catalog", "lumi-preview-v1.0", "Lumi Preview v1.0",
      expect.arrayContaining([
        expect.objectContaining({ name: "code.zip.enc" }),
        expect.objectContaining({ name: "metadata.json.enc" }),
      ]),
      "tok"
    );
  });
});
