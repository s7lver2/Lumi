// apps/web/lib/search/run-refine.test.ts
import { describe, it, expect, vi } from "vitest";
import { runRefine } from "./run-refine";
import type { RegionCandidate } from "./refine-retrieval";

describe("runRefine", () => {
  it("reads images, verifies present candidates, skips missing ones, and persists", async () => {
    const candidates: RegionCandidate[] = [
      { indexedImageId: "img-hi", panoId: "hi", heading: 0, lat: 1, lng: 2, imagePath: "/i/hi.jpg" },
      { indexedImageId: "img-missing", panoId: "mi", heading: 0, lat: 1, lng: 2, imagePath: null },
    ];

    const deps = {
      confirmThreshold: 0.5,
      getQueryImagePath: vi.fn().mockResolvedValue("/tmp/q.jpg"),
      expandRegion: vi.fn().mockResolvedValue(candidates),
      readImage: vi.fn().mockImplementation(async (p: string | null) => (p === "/i/hi.jpg" ? "HI64" : p === "/tmp/q.jpg" ? "Q64" : null)),
      verify: vi.fn().mockResolvedValue([{ inliers: 50, reprojError: 1, score: 0.9 }]),
      persist: vi.fn().mockResolvedValue([
        { id: "c1", regionId: "r1", indexedImageId: "img-hi", panoId: "hi", heading: 0, lat: 1, lng: 2, similarityScore: 0, verificationScore: 0.9, rank: 1, status: "confirmed" },
      ]),
    };

    const res = await runRefine(deps, { searchId: "s1", regionId: "r1" });

    // only the present candidate went to /verify
    expect(deps.verify).toHaveBeenCalledWith("Q64", ["HI64"]);
    // persist got exactly one scored candidate (the missing one was skipped)
    const persistArg = deps.persist.mock.calls[0][0];
    expect(persistArg.scored).toHaveLength(1);
    expect(persistArg.scored[0].indexedImageId).toBe("img-hi");
    expect(persistArg.scored[0].verificationScore).toBe(0.9);
    expect(res.candidates[0].status).toBe("confirmed");
    expect(res.regionId).toBe("r1");
  });

  it("returns an empty candidate list when no candidate has an image", async () => {
    const deps = {
      confirmThreshold: 0.5,
      getQueryImagePath: vi.fn().mockResolvedValue("/tmp/q.jpg"),
      expandRegion: vi.fn().mockResolvedValue([
        { indexedImageId: "x", panoId: "x", heading: 0, lat: 0, lng: 0, imagePath: null },
      ]),
      readImage: vi.fn().mockImplementation(async (p: string) => (p === "/tmp/q.jpg" ? "Q64" : null)),
      verify: vi.fn(),
      persist: vi.fn().mockResolvedValue([]),
    };
    const res = await runRefine(deps, { searchId: "s1", regionId: "r1" });
    expect(deps.verify).not.toHaveBeenCalled();
    expect(res.candidates).toEqual([]);
  });
});