// packages/shared-types/src/models.test.ts
import { describe, it, expect } from "vitest";
import { RETRIEVAL_MODELS, VERIFICATION_MODELS } from "./models";

describe("RETRIEVAL_MODELS", () => {
  it("includes lumi-preview as the default, backed by frozen MegaLoc", () => {
    const lumi = RETRIEVAL_MODELS.find((m) => m.id === "lumi-preview")!;
    expect(lumi).toBeDefined();
    expect(lumi.displayName).toBe("Lumi Preview");
    expect(lumi.baseModel).toMatch(/MegaLoc/);
    expect(lumi.status).toBe("preview");
    expect(lumi.embeddingDim).toBe(8448);
  });
});

describe("RETRIEVAL_MODELS version field", () => {
  it("gives every retrieval model a non-empty version string", () => {
    for (const model of RETRIEVAL_MODELS) {
      expect(typeof model.version).toBe("string");
      expect(model.version.length).toBeGreaterThan(0);
    }
  });
});

describe("VERIFICATION_MODELS", () => {
  it("ships with no hardcoded verification models — those are catalog-installed", () => {
    expect(VERIFICATION_MODELS).toEqual([]);
  });
});