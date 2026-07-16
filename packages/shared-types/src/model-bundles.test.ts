// packages/shared-types/src/model-bundles.test.ts
import { describe, it, expect } from "vitest";
import { MODEL_BUNDLES, resolveModelBundle } from "./model-bundles";

describe("MODEL_BUNDLES", () => {
  it("has at least one entry with the expected shape", () => {
    expect(MODEL_BUNDLES.length).toBeGreaterThan(0);
    const lumiPreview = MODEL_BUNDLES.find((b) => b.id === "lumi-preview")!;
    expect(lumiPreview).toBeDefined();
    expect(lumiPreview.displayName).toBe("Lumi Preview");
    expect(lumiPreview.retrievalModelId).toBe("lumi-preview");
    expect(lumiPreview.verificationModelId).toBe("laila");
    expect(lumiPreview.version).toBe("1.0");
    expect(lumiPreview.status).toBe("preview");
  });
});

describe("resolveModelBundle", () => {
  it("returns the matching bundle for a known pair", () => {
    const bundle = resolveModelBundle("lumi-preview", "laila");
    expect(bundle?.id).toBe("lumi-preview");
  });

  it("returns null for an unknown/mismatched pair", () => {
    expect(resolveModelBundle("lumi-preview", "some-other-verification-model")).toBeNull();
    expect(resolveModelBundle("nonexistent-model", "laila")).toBeNull();
  });
});
