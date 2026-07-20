// apps/web/app/api/datasets/install/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";

vi.mock("../../../../lib/db", () => ({ getPool: vi.fn() }));
vi.mock("../../../../lib/datasets/github", () => ({ listReleasesForRepo: vi.fn(), downloadReleaseAsset: vi.fn() }));
vi.mock("../../../../lib/datasets/active-model", () => ({ getActiveModelTag: vi.fn() }));
vi.mock("../../../../lib/queue", () => ({ enqueueEmbedPendingImagesJob: vi.fn() }));
vi.mock("../../../../lib/settings-repo", () => ({ getSettingsRepo: vi.fn(() => ({ getSetting: vi.fn().mockResolvedValue(null) })) }));
// The route stages downloaded images to a real temp dir and writes real
// capture-image files to streetViewImageDir() — mock node:fs/promises so
// this unit test never touches the real filesystem.
vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn().mockResolvedValue("/tmp/fake-staging-dir"),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../lib/background-jobs", () => ({
  createJob: vi.fn().mockResolvedValue("job-1"),
  completeJob: vi.fn(),
  failJob: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/datasets/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function encryptedMetadata(model: { id: string; version: string; embeddingDim: number }) {
  const { encryptBuffer } = await import("@netryx/settings-repo");
  const { DATASET_SHARED_KEY } = await import("../../../../lib/datasets/shared-key");
  return encryptBuffer(
    Buffer.from(JSON.stringify({ title: "T", description: "D", model, stats: { pointsCaptured: 0, imagesEmbedded: 0 } })),
    DATASET_SHARED_KEY
  );
}

describe("POST /api/datasets/install", () => {
  it("404s when the release/tag isn't found", async () => {
    const { listReleasesForRepo } = await import("../../../../lib/datasets/github");
    (listReleasesForRepo as any).mockResolvedValue([]);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-madrid", tag: "missing-v1.0" }));
    expect(res.status).toBe(404);
  });

  it("409s on a model mismatch when forceInstall isn't set, without downloading the bundle", async () => {
    const { listReleasesForRepo, downloadReleaseAsset } = await import("../../../../lib/datasets/github");
    (listReleasesForRepo as any).mockResolvedValue([
      { tagName: "future-model-v2.0", name: "x", body: "", assets: [{ name: "metadata.json.enc", url: "meta-url" }, { name: "bundle.zip.enc", url: "bundle-url" }] },
    ]);
    (downloadReleaseAsset as any).mockImplementation(async (url: string) => {
      if (url === "meta-url") return encryptedMetadata({ id: "future-model", version: "2.0", embeddingDim: 512 });
      throw new Error("should not download the bundle before the compatibility check");
    });

    const { getActiveModelTag } = await import("../../../../lib/datasets/active-model");
    (getActiveModelTag as any).mockResolvedValue({ id: "lumi-preview", version: "1.0", embeddingDim: 8448 });

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-madrid", tag: "future-model-v2.0" }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.compatible).toBe(false);
    expect(json.datasetModel.id).toBe("future-model");
    expect(json.activeModel.id).toBe("lumi-preview");
  });

  it("400s when the release is missing an expected asset", async () => {
    const { listReleasesForRepo } = await import("../../../../lib/datasets/github");
    (listReleasesForRepo as any).mockResolvedValue([
      { tagName: "lumi-preview-v1.0", name: "x", body: "", assets: [] },
    ]);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-madrid", tag: "lumi-preview-v1.0" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/datasets/install — success path", () => {
  it("returns 202 with a jobId once compatibility passes", async () => {
    const { listReleasesForRepo, downloadReleaseAsset } = await import("../../../../lib/datasets/github");
    (listReleasesForRepo as any).mockResolvedValue([
      { tagName: "lumi-madrid-v1.0", name: "x", body: "", assets: [
        { name: "metadata.json.enc", url: "meta-url" },
        { name: "bundle.zip.enc", url: "bundle-url" },
      ] },
    ]);
    (downloadReleaseAsset as any).mockImplementation(async (url: string) => {
      if (url === "meta-url") return encryptedMetadata({ id: "lumi-preview", version: "1.0", embeddingDim: 8448 });
      throw new Error(`unexpected asset url in this test: ${url}`);
    });

    const { getActiveModelTag } = await import("../../../../lib/datasets/active-model");
    (getActiveModelTag as any).mockResolvedValue({ id: "lumi-preview", version: "1.0", embeddingDim: 8448 });

    const { createJob } = await import("../../../../lib/background-jobs");

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-madrid", tag: "lumi-madrid-v1.0" }));
    const json = await res.json();

    expect(res.status).toBe(202);
    expect(json).toEqual({ jobId: "job-1" });
    expect(createJob).toHaveBeenCalledWith(expect.anything(), "dataset-install", "inigo/lumi-madrid@lumi-madrid-v1.0");
  });
});

describe("runDatasetInstallJob", () => {
  it("stages images, writes areas/indexed_images/indexed_points, and completes the job", async () => {
    const { runDatasetInstallJob } = await import("./route");
    const { downloadReleaseAsset } = await import("../../../../lib/datasets/github");
    const { encryptBuffer } = await import("@netryx/settings-repo");
    const { DATASET_SHARED_KEY } = await import("../../../../lib/datasets/shared-key");
    const { completeJob } = await import("../../../../lib/background-jobs");

    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({
      areas: [{
        name: "Madrid", geometryWkt: "POLYGON((0 0,0 1,1 1,1 0,0 0))", areaKm2: 1, status: "indexed",
        pointsEstimated: 1, pointsCaptured: 1, pointsFailed: 0, imagesEmbedded: 0,
        estimatedCostUsd: 0, actualCostUsd: 0,
        images: [], points: [],
      }],
    }));
    const zipBytes = await zip.generateAsync({ type: "nodebuffer" });
    (downloadReleaseAsset as any).mockResolvedValue(encryptBuffer(zipBytes, DATASET_SHARED_KEY));

    const query = vi.fn().mockResolvedValue({ rows: [{ id: "area-1" }] });
    const pool = { query } as any;

    await runDatasetInstallJob(pool, "job-1", { bundleAssetUrl: "bundle-url", token: undefined, compatible: true });

    expect(query.mock.calls[0][0]).toContain("INSERT INTO areas");
    expect(completeJob).toHaveBeenCalledWith(pool, "job-1", { areaId: "area-1", compatible: true });
  });

  it("calls failJob instead of throwing when the bundle download fails", async () => {
    const { runDatasetInstallJob } = await import("./route");
    const { downloadReleaseAsset } = await import("../../../../lib/datasets/github");
    (downloadReleaseAsset as any).mockRejectedValue(new Error("network error"));
    const { failJob } = await import("../../../../lib/background-jobs");

    const pool = { query: vi.fn() } as any;
    await runDatasetInstallJob(pool, "job-1", { bundleAssetUrl: "bundle-url", token: undefined, compatible: true });

    expect(failJob).toHaveBeenCalledWith(pool, "job-1", "network error");
  });
});