// apps/web/app/api/model-catalog/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/model-catalog/github", () => ({
  searchRepositoriesByTopic: vi.fn(),
  listReleasesForRepo: vi.fn(),
  downloadReleaseAsset: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/model-catalog", () => {
  it("groups releases by repo and marks the currently-active version", async () => {
    const github = await import("../../../lib/model-catalog/github");
    (github.searchRepositoriesByTopic as any).mockResolvedValue([{ owner: "inigo", repo: "lumi-model-catalog" }]);
    (github.listReleasesForRepo as any).mockResolvedValue([
      { tagName: "lumi-preview-v1.0", name: "x", body: "", assets: [{ name: "metadata.json.enc", url: "meta-1" }] },
      { tagName: "lumi-preview-v1.1", name: "x", body: "", assets: [{ name: "metadata.json.enc", url: "meta-2" }] },
    ]);

    const { encryptBuffer } = await import("@netryx/settings-repo");
    const { MODEL_CATALOG_SHARED_KEY } = await import("../../../lib/model-catalog/shared-key");
    const metaA = { bundleId: "lumi-preview", version: "1.0", backbones: [], benchmark: { accuracyWithin50m: 0.83, avgDistanceM: 12, sampleCount: 20, ranAt: "x" }, description: "" };
    const metaB = { bundleId: "lumi-preview", version: "1.1", backbones: [], benchmark: { accuracyWithin50m: 0.89, avgDistanceM: 8, sampleCount: 20, ranAt: "x" }, description: "" };
    (github.downloadReleaseAsset as any)
      .mockResolvedValueOnce(encryptBuffer(Buffer.from(JSON.stringify(metaA)), MODEL_CATALOG_SHARED_KEY))
      .mockResolvedValueOnce(encryptBuffer(Buffer.from(JSON.stringify(metaB)), MODEL_CATALOG_SHARED_KEY));

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(json.bundles).toHaveLength(1);
    const releases = json.bundles[0].releases;
    expect(releases.find((r: any) => r.version === "1.0").isActive).toBe(true);
    expect(releases.find((r: any) => r.version === "1.1").isActive).toBe(false);
  });
});
