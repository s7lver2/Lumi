import { describe, it, expect } from "vitest";
import { USE_CASES } from "./model-recommendations";

describe("USE_CASES", () => {
  it("has a non-empty label and id for every use case", () => {
    for (const useCase of USE_CASES) {
      expect(useCase.id.length).toBeGreaterThan(0);
      expect(useCase.label.length).toBeGreaterThan(0);
    }
  });
});
