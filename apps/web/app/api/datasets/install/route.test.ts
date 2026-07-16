// apps/web/app/api/datasets/install/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";

vi.mock("../../../../lib/db", () => ({ getPool: vi.fn() }));
vi.mock("../../../../lib/datasets/github", () => ({ listReleasesForRepo: vi.fn(), downloadReleaseAsset: vi.fn() }));
vi.mock("../../../../lib/datasets/active-model", () => ({ getActiveModelTag: vi.fn() }));
vi.mock("../../../../lib/queue", () => ({ enqueueEmbedPendingImagesJob: vi.fn() }));
// The route stages downloaded images to a real temp dir and writes real
// capture-image files to streetViewImageDir() — mock node:fs/promises so
// this unit test never touches the real filesystem.
vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn().mockResolvedValue("/tmp/fake-staging-dir"),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
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

  it("stages a real JSZip bundle, writes rows via the pool, and returns 201 on a compatible install", async () => {
    const { listReleasesForRepo, downloadReleaseAsset } = await import("../../../../lib/datasets/github");
    const { encryptBuffer } = await import("@netryx/settings-repo");
    const { DATASET_SHARED_KEY } = await import("../../../../lib/datasets/shared-key");
    const model = { id: "lumi-preview", version: "1.0", embeddingDim: 3 };

    const zip = new JSZip();
    // Real JPEG magic bytes so isLikelyJpeg() passes.
    zip.file("images/abc123_0.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]));
    zip.file(
      "manifest.json",
      JSON.stringify({
        version: 1,
        exportedAt: "2026-07-14T00:00:00.000Z",
        model,
        areas: [
          {
            name: "Test area",
            geometryWkt: "POLYGON((0 0,0 1,1 1,1 0,0 0))",
            areaKm2: 1,
            status: "indexed",
            pointsEstimated: 1,
            pointsCaptured: 1,
            pointsFailed: 0,
            imagesEmbedded: 1,
            estimatedCostUsd: null,
            actualCostUsd: null,
            images: [
              { panoId: "abc123", heading: 0, lat: 0, lng: 0, streetViewDate: null, embedding: [0.1, 0.2, 0.3], hasFile: true },
            ],
            points: [{ panoId: "abc123", lat: 0, lng: 0, embedding: [0.1, 0.2, 0.3] }],
          },
        ],
      })
    );
    const zipBytes = await zip.generateAsync({ type: "nodebuffer" });

    (listReleasesForRepo as any).mockResolvedValue([
      {
        tagName: "lumi-preview-v1.0", name: "x", body: "",
        assets: [{ name: "metadata.json.enc", url: "meta-url" }, { name: "bundle.zip.enc", url: "bundle-url" }],
      },
    ]);
    (downloadReleaseAsset as any).mockImplementation(async (url: string) => {
      if (url === "meta-url") return encryptedMetadata(model);
      if (url === "bundle-url") return encryptBuffer(zipBytes, DATASET_SHARED_KEY);
      throw new Error(`unexpected asset url: ${url}`);
    });

    const { getActiveModelTag } = await import("../../../../lib/datasets/active-model");
    (getActiveModelTag as any).mockResolvedValue(model);

    const { getPool } = await import("../../../../lib/db");
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "new-area-id" }] });
    (getPool as any).mockReturnValue({ query });

    const { enqueueEmbedPendingImagesJob } = await import("../../../../lib/queue");

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-madrid", tag: "lumi-preview-v1.0" }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual({ areaId: "new-area-id", compatible: true });
    // Compatible install must NOT enqueue the embed-pending-images job — that
    // job only exists to backfill embeddings after a mismatched install.
    expect(enqueueEmbedPendingImagesJob).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO areas"), expect.any(Array));
  });
});
