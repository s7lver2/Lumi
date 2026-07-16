// apps/web/lib/datasets/active-model.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../settings-repo", () => ({
  getSettingsRepo: vi.fn(),
}));

describe("getActiveModelTag", () => {
  it("resolves the active RETRIEVAL_MODEL setting to a full ModelTag", async () => {
    const { getSettingsRepo } = await import("../settings-repo");
    (getSettingsRepo as any).mockReturnValue({
      getSetting: vi.fn().mockResolvedValue("lumi-preview"),
    });

    const { getActiveModelTag } = await import("./active-model");
    const tag = await getActiveModelTag();

    expect(tag).toEqual({ id: "lumi-preview", version: "1.0", embeddingDim: 8448 });
  });

  it("defaults to lumi-preview when the setting isn't set yet", async () => {
    const { getSettingsRepo } = await import("../settings-repo");
    (getSettingsRepo as any).mockReturnValue({
      getSetting: vi.fn().mockResolvedValue(null),
    });

    const { getActiveModelTag } = await import("./active-model");
    const tag = await getActiveModelTag();

    expect(tag.id).toBe("lumi-preview");
  });
});
