// apps/web/app/api/model-catalog/publish/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../lib/db", () => ({ getPool: vi.fn(() => ({ query: vi.fn().mockResolvedValue({ rows: [] }) })) }));
vi.mock("../../../../lib/settings-repo", () => ({ getSettingsRepo: vi.fn() }));
vi.mock("../../../../lib/model-catalog/benchmark", () => ({
  buildReferenceSet: vi.fn(),
  runBenchmark: vi.fn(),
  passesBenchmarkThreshold: vi.fn(),
  measureVramDelta: vi.fn(),
}));
vi.mock("../../../../lib/model-catalog/code-bundle", () => ({ buildInferenceCodeZip: vi.fn() }));
vi.mock("../../../../lib/model-catalog/github", () => ({ ensureRepoWithTopic: vi.fn(), upsertRelease: vi.fn() }));

beforeEach(async () => {
  vi.clearAllMocks();
  // Default: actually run the passed warmup callback (route.ts assigns
  // benchmarkResult inside it for the retrieval path) and report a
  // plausible byte count — without this, measureVramDelta is an empty
  // vi.fn() returning undefined, the callback never runs, and every test
  // silently falls into the benchmarkPending catch branch instead of
  // exercising the real success path (confirmed live: this exact gap let
  // 3 of these 4 tests pass for the wrong reason after benchmarkPending
  // was added, since the pending fallback happens to satisfy their
  // assertions too).
  const { measureVramDelta } = await import("../../../../lib/model-catalog/benchmark");
  (measureVramDelta as any).mockImplementation(async (_snapshot: unknown, cb: () => Promise<void>) => {
    await cb();
    return 123456;
  });
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
      getSetting: vi.fn((key: string) => {
        if (key === "GITHUB_TOKEN") return Promise.resolve("tok");
        if (key === "MODEL_CATALOG_REPO") return Promise.resolve("inigo/lumi-model-catalog");
        if (key === "VERIFICATION_MODEL") return Promise.resolve("roma-verify");
        return Promise.resolve(null);
      }),
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

  it("includes the currently-configured verification model id in the published manifest", async () => {
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({
      getSetting: vi.fn((key: string) => {
        if (key === "GITHUB_TOKEN") return Promise.resolve("tok");
        if (key === "MODEL_CATALOG_REPO") return Promise.resolve("inigo/lumi-model-catalog");
        if (key === "VERIFICATION_MODEL") return Promise.resolve("roma-verify");
        return Promise.resolve(null);
      }),
    });
    const { buildReferenceSet, runBenchmark, passesBenchmarkThreshold } = await import("../../../../lib/model-catalog/benchmark");
    (buildReferenceSet as any).mockResolvedValue([{ indexedImageId: "i1", imagePath: "/a.jpg", trueLat: 0, trueLng: 0 }]);
    (runBenchmark as any).mockResolvedValue({ accuracyWithin50m: 0.9, avgDistanceM: 5, sampleCount: 1, ranAt: "x" });
    (passesBenchmarkThreshold as any).mockReturnValue(true);

    const { buildInferenceCodeZip } = await import("../../../../lib/model-catalog/code-bundle");
    (buildInferenceCodeZip as any).mockResolvedValue(new Uint8Array([1, 2, 3]));

    const { upsertRelease } = await import("../../../../lib/model-catalog/github");
    const { decryptBuffer } = await import("@netryx/settings-repo");
    const { MODEL_CATALOG_SHARED_KEY } = await import("../../../../lib/model-catalog/shared-key");

    const { POST } = await import("./route");
    await POST(makeRequest({ description: "Better re-ranking" }));

    const [, , , , assets] = (upsertRelease as any).mock.calls[0];
    const metadataAsset = assets.find((a: any) => a.name === "metadata.json.enc");
    const manifest = JSON.parse(decryptBuffer(metadataAsset.data, MODEL_CATALOG_SHARED_KEY).toString("utf8"));
    expect(manifest.verificationModelId).toBe("roma-verify");
  });
});

describe("POST /api/model-catalog/publish — generic-classifier VRAM warmup is install-neutral", () => {
  it("restores the publisher's own pre-existing active row after the temporary measurement, leaving no extra row behind", async () => {
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({
      getSetting: vi.fn((key: string) => Promise.resolve(key === "GITHUB_TOKEN" ? "tok" : "inigo/lumi-model-catalog")),
    });

    const { ensureRepoWithTopic, upsertRelease } = await import("../../../../lib/model-catalog/github");

    const calls: { sql: string; params: unknown[] }[] = [];
    const { getPool } = await import("../../../../lib/db");
    (getPool as any).mockReturnValue({
      query: vi.fn(async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        // The publisher's own machine already has this modelId installed
        // and active before this publish call starts.
        if (sql.includes("SELECT id FROM installed_classification_models") && sql.includes("active = true")) {
          return { rows: [{ id: "real-active-row-id" }] };
        }
        if (sql.includes("INSERT INTO installed_classification_models")) {
          return { rows: [{ id: "temp-draft-row-id" }] };
        }
        return { rows: [] };
      }),
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        kind: "generic-classifier",
        modelId: "wanda-v1",
        version: "1.0",
        facets: [{ facet: "weather", hfModelId: "prithivMLmods/Weather-Image-Classification", strategy: "pipeline" }],
        sampleImageBase64: "ZmFrZQ==",
      })
    );

    expect(res.status).toBe(200);
    expect(ensureRepoWithTopic).toHaveBeenCalled();
    expect(upsertRelease).toHaveBeenCalled();

    // Exactly the pre-existing active row was deactivated, then a temp
    // row was inserted, then (in the finally block) the temp row was
    // deleted by its OWN id and the original row reactivated by ITS OWN
    // id — never a generic "reactivate whatever's most recent" step.
    const deactivateReal = calls.find((c) => c.sql.includes("SET active = false") && c.params.includes("real-active-row-id"));
    const deleteTemp = calls.find((c) => c.sql.includes("DELETE FROM installed_classification_models") && c.params.includes("temp-draft-row-id"));
    const reactivateReal = calls.find((c) => c.sql.includes("SET active = true") && c.params.includes("real-active-row-id"));

    expect(deactivateReal).toBeDefined();
    expect(deleteTemp).toBeDefined();
    expect(reactivateReal).toBeDefined();
    // Never reactivate the temp row itself, and never delete the real row.
    expect(calls.some((c) => c.sql.includes("SET active = true") && c.params.includes("temp-draft-row-id"))).toBe(false);
    expect(calls.some((c) => c.sql.includes("DELETE FROM installed_classification_models") && c.params.includes("real-active-row-id"))).toBe(false);

    vi.unstubAllGlobals();
  });

  it("leaves nothing active when the modelId had no prior install (only the temp row is deleted, nothing reactivated)", async () => {
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({
      getSetting: vi.fn((key: string) => Promise.resolve(key === "GITHUB_TOKEN" ? "tok" : "inigo/lumi-model-catalog")),
    });

    const calls: { sql: string; params: unknown[] }[] = [];
    const { getPool } = await import("../../../../lib/db");
    (getPool as any).mockReturnValue({
      query: vi.fn(async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        if (sql.includes("SELECT id FROM installed_classification_models") && sql.includes("active = true")) {
          return { rows: [] }; // nothing installed before this publish
        }
        if (sql.includes("INSERT INTO installed_classification_models")) {
          return { rows: [{ id: "temp-draft-row-id" }] };
        }
        return { rows: [] };
      }),
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        kind: "generic-classifier",
        modelId: "velle-v1",
        version: "1.0",
        facets: [{ facet: "vehicle", hfModelId: "Jordo23/vehicle-classifier", strategy: "pipeline" }],
        sampleImageBase64: "ZmFrZQ==",
      })
    );

    expect(res.status).toBe(200);
    expect(calls.some((c) => c.sql.includes("DELETE FROM installed_classification_models") && c.params.includes("temp-draft-row-id"))).toBe(true);
    expect(calls.some((c) => c.sql.includes("SET active = true"))).toBe(false);

    vi.unstubAllGlobals();
  });
});
