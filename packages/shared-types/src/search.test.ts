import { describe, it, expect } from "vitest";
import {
  DEFAULT_TOP_K,
  DEFAULT_REGION_RADIUS_M,
  DEFAULT_QUERY_EXPANSION_SIZE,
  DEFAULT_CONFIRM_THRESHOLD,
} from "./search";
import type { RefineRequest } from "./search";


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

describe("RefineRequest", () => {
  it("carries both searchId and regionId in the body (no longer just regionId)", () => {
    const body: RefineRequest = { searchId: "search-1", regionId: "region-1" };
    expect(body.searchId).toBe("search-1");
    expect(body.regionId).toBe("region-1");
  });
});