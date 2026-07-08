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

describe("VERIFICATION_MODELS", () => {
  it("includes laila as the default, backed by frozen RoMa", () => {
    const laila = VERIFICATION_MODELS.find((m) => m.id === "laila")!;
    expect(laila).toBeDefined();
    expect(laila.displayName).toBe("Laila");
    expect(laila.baseModel).toMatch(/RoMa/);
    expect(laila.status).toBe("stable");
  });
});