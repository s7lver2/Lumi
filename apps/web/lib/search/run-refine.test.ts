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

  it("verifies one candidate per /verify call, not one giant batch (RoMa is slow per-pair, and main.py's own /verify handler already loops sequentially)", async () => {
    const totalCandidates = 20;
    const candidates: RegionCandidate[] = Array.from({ length: totalCandidates }, (_, i) => ({
      indexedImageId: `img-${i}`,
      panoId: `p${i}`,
      heading: 0,
      lat: 1,
      lng: 2,
      imagePath: `/i/${i}.jpg`,
    }));
    const verify = vi.fn().mockImplementation(async (_q: string, cands: string[]) =>
      cands.map(() => ({ inliers: 10, reprojError: 1, score: 0.7 }))
    );
    const deps = {
      confirmThreshold: 0.5,
      getQueryImagePath: vi.fn().mockResolvedValue("/tmp/q.jpg"),
      expandRegion: vi.fn().mockResolvedValue(candidates),
      readImage: vi.fn().mockImplementation(async (p: string) => (p === "/tmp/q.jpg" ? "Q64" : `B64-${p}`)),
      verify,
      persist: vi.fn().mockResolvedValue([]),
    };

    await runRefine(deps, { searchId: "s1", regionId: "r1" });

    expect(verify.mock.calls.length).toBe(20);
    for (const call of verify.mock.calls) {
      expect(call[1]).toHaveLength(1);
    }

    const persistArg = deps.persist.mock.calls[0][0];
    expect(persistArg.scored).toHaveLength(20);
  });

  it("reports progress after each candidate via onProgress, starting at 0/total", async () => {
    const candidates: RegionCandidate[] = Array.from({ length: 3 }, (_, i) => ({
      indexedImageId: `img-${i}`,
      panoId: `p${i}`,
      heading: 0,
      lat: 1,
      lng: 2,
      imagePath: `/i/${i}.jpg`,
    }));
    const onProgress = vi.fn();
    const deps = {
      confirmThreshold: 0.5,
      getQueryImagePath: vi.fn().mockResolvedValue("/tmp/q.jpg"),
      expandRegion: vi.fn().mockResolvedValue(candidates),
      readImage: vi.fn().mockImplementation(async (p: string) => (p === "/tmp/q.jpg" ? "Q64" : `B64-${p}`)),
      verify: vi.fn().mockResolvedValue([{ inliers: 10, reprojError: 1, score: 0.7 }]),
      persist: vi.fn().mockResolvedValue([]),
      onProgress,
    };

    await runRefine(deps, { searchId: "s1", regionId: "r1" });

    expect(onProgress.mock.calls).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("retries a candidate once if verify throws, and succeeds without aborting the batch", async () => {
    const candidates: RegionCandidate[] = [
      { indexedImageId: "img-flaky", panoId: "flaky", heading: 0, lat: 1, lng: 2, imagePath: "/i/flaky.jpg" },
      { indexedImageId: "img-ok", panoId: "ok", heading: 0, lat: 1, lng: 2, imagePath: "/i/ok.jpg" },
    ];
    const verify = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce([{ inliers: 20, reprojError: 1, score: 0.6 }])
      .mockResolvedValueOnce([{ inliers: 30, reprojError: 1, score: 0.8 }]);
    const deps = {
      confirmThreshold: 0.5,
      getQueryImagePath: vi.fn().mockResolvedValue("/tmp/q.jpg"),
      expandRegion: vi.fn().mockResolvedValue(candidates),
      readImage: vi.fn().mockImplementation(async (p: string) => (p === "/tmp/q.jpg" ? "Q64" : `B64-${p}`)),
      verify,
      persist: vi.fn().mockResolvedValue([]),
    };

    await runRefine(deps, { searchId: "s1", regionId: "r1" });

    expect(verify).toHaveBeenCalledTimes(3); // 1 failure + 1 retry for the flaky one, + 1 for the ok one
    const persistArg = deps.persist.mock.calls[0][0];
    expect(persistArg.scored).toHaveLength(2);
    expect(persistArg.scored[0].verificationScore).toBe(0.6); // the retried candidate still got a real score
    expect(persistArg.scored[1].verificationScore).toBe(0.8);
  });

  it("falls back to an unverified (score 0) result if a candidate fails twice, without losing the rest of the batch", async () => {
    const candidates: RegionCandidate[] = [
      { indexedImageId: "img-dead", panoId: "dead", heading: 0, lat: 1, lng: 2, imagePath: "/i/dead.jpg" },
      { indexedImageId: "img-ok", panoId: "ok", heading: 0, lat: 1, lng: 2, imagePath: "/i/ok.jpg" },
    ];
    const verify = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout again"))
      .mockResolvedValueOnce([{ inliers: 30, reprojError: 1, score: 0.8 }]);
    const deps = {
      confirmThreshold: 0.5,
      getQueryImagePath: vi.fn().mockResolvedValue("/tmp/q.jpg"),
      expandRegion: vi.fn().mockResolvedValue(candidates),
      readImage: vi.fn().mockImplementation(async (p: string) => (p === "/tmp/q.jpg" ? "Q64" : `B64-${p}`)),
      verify,
      persist: vi.fn().mockResolvedValue([]),
    };

    const res = await runRefine(deps, { searchId: "s1", regionId: "r1" });

    expect(res.regionId).toBe("r1"); // did not throw / abort
    const persistArg = deps.persist.mock.calls[0][0];
    expect(persistArg.scored).toHaveLength(2); // both candidates still make it to persist
    const dead = persistArg.scored.find((s: any) => s.indexedImageId === "img-dead");
    expect(dead.verificationScore).toBe(0);
    const ok = persistArg.scored.find((s: any) => s.indexedImageId === "img-ok");
    expect(ok.verificationScore).toBe(0.8);
  });
});