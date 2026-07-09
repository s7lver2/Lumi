// packages/geo-sampling/src/cost.test.ts
import { describe, it, expect } from "vitest";
import { estimateIndexingCostUsd, assertAreaWithinSizeLimit } from "./cost";

describe("estimateIndexingCostUsd", () => {
  it("multiplies points × headings × price per image", () => {
    expect(estimateIndexingCostUsd(1000, 4, 0.007)).toBeCloseTo(28.0, 5);
  });
});

describe("assertAreaWithinSizeLimit", () => {
  it("does not throw when the area is within the limit", () => {
    expect(() => assertAreaWithinSizeLimit(4.2, 5)).not.toThrow();
  });

  it("throws a clear error when the area exceeds the limit", () => {
    expect(() => assertAreaWithinSizeLimit(12, 5)).toThrow(
      /12(\.0+)? km² exceeds the configured limit of 5 km²/
    );
  });
});