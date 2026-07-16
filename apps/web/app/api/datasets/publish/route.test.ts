// apps/web/app/api/datasets/publish/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// The route also queries the pool directly (for points_captured/images_embedded
// stats, separate from buildAreasZip which is mocked below) — getPool() must
// return a real .query mock, not `{}`, or that call throws a TypeError.
vi.mock("../../../../lib/db", () => ({
  getPool: vi.fn(() => ({
    query: vi.fn().mockResolvedValue({ rows: [{ points_captured: 10, images_embedded: 40 }] }),
  })),
}));
vi.mock("../../../../lib/settings-repo", () => ({ getSettingsRepo: vi.fn() }));
vi.mock("../../../../lib/datasets/active-model", () => ({ getActiveModelTag: vi.fn() }));
vi.mock("../../../../lib/datasets/export-bundle", () => ({ buildAreasZip: vi.fn() }));
vi.mock("../../../../lib/datasets/github", () => ({ ensureRepoWithTopic: vi.fn(), upsertRelease: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/datasets/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/datasets/publish", () => {
  it("400s when GITHUB_TOKEN isn't configured", async () => {
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ getSetting: vi.fn().mockResolvedValue(null) });

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ areaId: "a1", title: "T", description: "D", owner: "inigo", repo: "lumi-madrid" }));
    expect(res.status).toBe(400);
  });

  it("builds the bundle, uploads it tagged with the active model, and returns the tag", async () => {
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ getSetting: vi.fn().mockResolvedValue("gh-token") });

    const { getActiveModelTag } = await import("../../../../lib/datasets/active-model");
    (getActiveModelTag as any).mockResolvedValue({ id: "lumi-preview", version: "1.0", embeddingDim: 8448 });

    const { buildAreasZip } = await import("../../../../lib/datasets/export-bundle");
    (buildAreasZip as any).mockResolvedValue(new Uint8Array([1, 2, 3]));

    const { ensureRepoWithTopic, upsertRelease } = await import("../../../../lib/datasets/github");

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ areaId: "a1", title: "T", description: "D", owner: "inigo", repo: "lumi-madrid" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.tag).toBe("lumi-preview-v1.0");
    expect(ensureRepoWithTopic).toHaveBeenCalledWith("inigo", "lumi-madrid", "gh-token");
    expect(upsertRelease).toHaveBeenCalledWith(
      "inigo", "lumi-madrid", "lumi-preview-v1.0", "Lumi Preview v1.0",
      expect.arrayContaining([
        expect.objectContaining({ name: "bundle.zip.enc" }),
        expect.objectContaining({ name: "metadata.json.enc" }),
      ]),
      "gh-token"
    );
  });

  it("400s when required fields are missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ areaId: "a1" }));
    expect(res.status).toBe(400);
  });
});
