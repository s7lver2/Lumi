// apps/web/app/api/datasets/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/datasets/github", () => ({
  searchRepositoriesByTopic: vi.fn(),
  listReleasesForRepo: vi.fn(),
  downloadReleaseAsset: vi.fn(),
}));
vi.mock("../../../lib/datasets/active-model", () => ({ getActiveModelTag: vi.fn() }));
vi.mock("../../../lib/settings-repo", () => ({ getSettingsRepo: vi.fn(() => ({ getSetting: vi.fn().mockResolvedValue(null) })) }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/datasets", () => {
  it("groups releases by repo and marks each release's compatibility against the active model", async () => {
    const github = await import("../../../lib/datasets/github");
    (github.searchRepositoriesByTopic as any).mockResolvedValue([{ owner: "inigo", repo: "lumi-madrid" }]);
    (github.listReleasesForRepo as any).mockResolvedValue([
      { tagName: "lumi-preview-v1.0", name: "Lumi Preview v1.0", body: "", assets: [{ name: "metadata.json.enc", url: "https://api.github.com/a/1" }] },
      { tagName: "future-model-v2.0", name: "Future Model v2.0", body: "", assets: [{ name: "metadata.json.enc", url: "https://api.github.com/a/2" }] },
    ]);

    const { encryptBuffer } = await import("@netryx/settings-repo");
    const { DATASET_SHARED_KEY } = await import("../../../lib/datasets/shared-key");
    const metaA = { title: "Downtown Madrid", description: "d", model: { id: "lumi-preview", version: "1.0", embeddingDim: 8448 }, stats: { pointsCaptured: 10, imagesEmbedded: 40 } };
    const metaB = { title: "Downtown Madrid", description: "d", model: { id: "future-model", version: "2.0", embeddingDim: 512 }, stats: { pointsCaptured: 10, imagesEmbedded: 40 } };
    (github.downloadReleaseAsset as any)
      .mockResolvedValueOnce(encryptBuffer(Buffer.from(JSON.stringify(metaA)), DATASET_SHARED_KEY))
      .mockResolvedValueOnce(encryptBuffer(Buffer.from(JSON.stringify(metaB)), DATASET_SHARED_KEY));

    const { getActiveModelTag } = await import("../../../lib/datasets/active-model");
    (getActiveModelTag as any).mockResolvedValue({ id: "lumi-preview", version: "1.0", embeddingDim: 8448 });

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(json.areas).toHaveLength(1);
    expect(json.areas[0].owner).toBe("inigo");
    expect(json.areas[0].releases).toHaveLength(2);
    expect(json.areas[0].releases.find((r: any) => r.tag === "lumi-preview-v1.0").compatible).toBe(true);
    expect(json.areas[0].releases.find((r: any) => r.tag === "future-model-v2.0").compatible).toBe(false);
  });
});
