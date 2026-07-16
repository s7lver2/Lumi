// apps/web/lib/datasets/compatibility.test.ts
import { describe, it, expect } from "vitest";
import { isCompatible } from "./compatibility";
import type { ModelTag } from "./manifest";

describe("isCompatible", () => {
  it("is true when id and version both match exactly", () => {
    const a: ModelTag = { id: "lumi-preview", version: "1.0", embeddingDim: 8448 };
    const b: ModelTag = { id: "lumi-preview", version: "1.0", embeddingDim: 8448 };
    expect(isCompatible(a, b)).toBe(true);
  });

  it("is false when versions differ, even with the same id", () => {
    const a: ModelTag = { id: "lumi-preview", version: "1.0", embeddingDim: 8448 };
    const b: ModelTag = { id: "lumi-preview", version: "2.0", embeddingDim: 8448 };
    expect(isCompatible(a, b)).toBe(false);
  });

  it("is false when ids differ, even if embeddingDim happens to match", () => {
    const a: ModelTag = { id: "lumi-preview", version: "1.0", embeddingDim: 8448 };
    const b: ModelTag = { id: "some-future-model", version: "1.0", embeddingDim: 8448 };
    expect(isCompatible(a, b)).toBe(false);
  });
});
