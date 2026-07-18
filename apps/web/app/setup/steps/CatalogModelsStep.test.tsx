import { describe, it, expect } from "vitest";
import { pickDefaultRelease } from "./CatalogModelsStep";

describe("pickDefaultRelease", () => {
  it("picks the highest-benchmark release across all bundles", () => {
    const bundles = [
      { owner: "a", repo: "r1", releases: [{ tag: "t1", version: "1.0", benchmark: { accuracyWithin50m: 0.7 } }] },
      { owner: "a", repo: "r2", releases: [{ tag: "t2", version: "1.0", benchmark: { accuracyWithin50m: 0.9 } }] },
    ];
    const picked = pickDefaultRelease(bundles as any);
    expect(picked?.repo).toBe("r2");
  });

  it("returns null when there are no releases at all", () => {
    expect(pickDefaultRelease([])).toBeNull();
  });
});
