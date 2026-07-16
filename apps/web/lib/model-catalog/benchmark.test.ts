// apps/web/lib/model-catalog/benchmark.test.ts
import { describe, it, expect, vi } from "vitest";
import { runBenchmark, passesBenchmarkThreshold, buildReferenceSet, BENCHMARK_ACCURACY_THRESHOLD } from "./benchmark";
import type { BenchmarkCase, BenchmarkDeps } from "./benchmark";

function makePool(rows: any[]) {
  return { query: vi.fn(async () => ({ rows })) } as any;
}

describe("buildReferenceSet", () => {
  it("selects up to `count` rows deterministically from local indexed images", async () => {
    const pool = makePool([
      { id: "img-1", image_path: "/data/a.jpg", lat: "40.0", lng: "-3.0" },
      { id: "img-2", image_path: "/data/b.jpg", lat: "41.0", lng: "-4.0" },
    ]);
    const cases = await buildReferenceSet(pool, 2);
    expect(cases).toEqual([
      { indexedImageId: "img-1", imagePath: "/data/a.jpg", trueLat: 40.0, trueLng: -3.0 },
      { indexedImageId: "img-2", imagePath: "/data/b.jpg", trueLat: 41.0, trueLng: -4.0 },
    ]);
  });
});

function makeDeps(overrides: Partial<BenchmarkDeps> = {}): BenchmarkDeps {
  return {
    readImageBase64: vi.fn().mockResolvedValue("ZmFrZQ=="),
    embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]),
    retrieve: vi.fn().mockResolvedValue([
      { indexedImageId: "other", panoId: "p2", heading: 0, lat: 40.0001, lng: -3.0001, similarity: 0.9, embedding: [0.1, 0.2] },
    ]),
    ...overrides,
  };
}

describe("runBenchmark", () => {
  it("scores each case's distance from the top clustered region to the true location", async () => {
    const cases: BenchmarkCase[] = [{ indexedImageId: "img-1", imagePath: "/data/a.jpg", trueLat: 40.0, trueLng: -3.0 }];
    const result = await runBenchmark(cases, makeDeps());

    expect(result.sampleCount).toBe(1);
    expect(result.accuracyWithin50m).toBe(1); // ~11m away, within 50m
    expect(result.avgDistanceM).toBeGreaterThan(0);
    expect(typeof result.ranAt).toBe("string");
  });

  it("scores 0 accuracy when retrieval returns nothing (Infinity distance)", async () => {
    const cases: BenchmarkCase[] = [{ indexedImageId: "img-1", imagePath: "/data/a.jpg", trueLat: 40.0, trueLng: -3.0 }];
    const result = await runBenchmark(cases, makeDeps({ retrieve: vi.fn().mockResolvedValue([]) }));
    expect(result.accuracyWithin50m).toBe(0);
  });

  it("calls retrieve with the case's own id excluded (leave-one-out)", async () => {
    const deps = makeDeps();
    const cases: BenchmarkCase[] = [{ indexedImageId: "img-1", imagePath: "/data/a.jpg", trueLat: 40.0, trueLng: -3.0 }];
    await runBenchmark(cases, deps);
    expect(deps.retrieve).toHaveBeenCalledWith([0.1, 0.2], "img-1");
  });
});

describe("passesBenchmarkThreshold", () => {
  it("passes at or above the threshold, fails below it", () => {
    expect(passesBenchmarkThreshold({ accuracyWithin50m: BENCHMARK_ACCURACY_THRESHOLD, avgDistanceM: 1, sampleCount: 1, ranAt: "x" })).toBe(true);
    expect(passesBenchmarkThreshold({ accuracyWithin50m: BENCHMARK_ACCURACY_THRESHOLD - 0.01, avgDistanceM: 1, sampleCount: 1, ranAt: "x" })).toBe(false);
  });
});
