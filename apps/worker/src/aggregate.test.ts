// apps/worker/src/aggregate.test.ts
import { describe, it, expect } from "vitest";
import { aggregatePanoDescriptors } from "./aggregate";
import type { StreetViewCapture } from "@netryx/shared-types";

function capture(panoId: string, heading: number): StreetViewCapture {
  return { panoId, heading, lat: 1, lng: 2, captureDate: null, imageBase64: "" };
}

describe("aggregatePanoDescriptors", () => {
  it("produces one L2-normalized mean descriptor per distinct pano", () => {
    const captures = [capture("pano-a", 0), capture("pano-a", 90), capture("pano-b", 0)];
    const embeddings = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const points = aggregatePanoDescriptors(captures, embeddings);

    expect(points).toHaveLength(2);
    const a = points.find((p) => p.panoId === "pano-a")!;
    // mean of [1,0,0] and [0,1,0] = [0.5,0.5,0], normalized = [~0.707,~0.707,0]
    expect(a.embedding[0]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(a.embedding[1]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(Math.hypot(...a.embedding)).toBeCloseTo(1, 5);
  });

  it("carries the pano's location through from the first capture of that pano", () => {
    const captures = [{ ...capture("pano-a", 0), lat: 40.1, lng: -3.7 }];
    const points = aggregatePanoDescriptors(captures, [[2, 0]]);
    expect(points[0].lat).toBe(40.1);
    expect(points[0].lng).toBe(-3.7);
    expect(Math.hypot(...points[0].embedding)).toBeCloseTo(1, 5);
  });
});