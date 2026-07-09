// apps/web/app/lib/snap.test.ts
import { describe, it, expect } from "vitest";
import { snapPoint } from "./snap";

describe("snapPoint", () => {
  const streets: [number, number][][] = [[[0, 0], [0, 0.01]], [[0.02, 0], [0.02, 0.01]]];
  it("snaps to the nearest street vertex within the threshold", () => {
    const snapped = snapPoint([0.0003, 0.005], streets, 100); // ~33m from x=0 line
    expect(snapped[0]).toBeCloseTo(0, 4);
  });
  it("leaves the point unchanged when nothing is within the threshold", () => {
    const p: [number, number] = [0.01, 0.005]; // ~1.1km from either line
    expect(snapPoint(p, streets, 50)).toEqual(p);
  });
});