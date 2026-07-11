import { describe, it, expect } from "vitest";
import {
  DEFAULT_TOP_K,
  DEFAULT_REGION_RADIUS_M,
  DEFAULT_QUERY_EXPANSION_SIZE,
  DEFAULT_CONFIRM_THRESHOLD,
} from "./search";


describe("search tuning constants", () => {
  it("uses the spec's k=50 top-k default (spec §9.2)", () => {
    expect(DEFAULT_TOP_K).toBe(50);
  });

  it("has a positive region radius and a query-expansion size smaller than top-k", () => {
    expect(DEFAULT_REGION_RADIUS_M).toBeGreaterThan(0);
    expect(DEFAULT_QUERY_EXPANSION_SIZE).toBeGreaterThan(0);
    expect(DEFAULT_QUERY_EXPANSION_SIZE).toBeLessThan(DEFAULT_TOP_K);
  });
});