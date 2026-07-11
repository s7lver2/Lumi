// packages/geo-sampling/src/sample.test.ts
import { describe, it, expect } from "vitest";
import * as turf from "@turf/turf";
import { samplePointsAlongStreets } from "./sample";
import type { LineStringGeoJSON } from "./overpass";

// A generous box around downtown-ish coordinates used across these tests —
// big enough to contain every in-bounds line/point fixture below.
const BIG_BOX: [number, number][] = [
  [-122.43, 37.77],
  [-122.41, 37.77],
  [-122.41, 37.78],
  [-122.43, 37.78],
  [-122.43, 37.77],
];

describe("samplePointsAlongStreets", () => {
  it("samples points every ~spacingMeters along a single straight line", () => {
    const start = turf.point([-122.42, 37.775]);
    const end = turf.destination(start, 0.1, 90, { units: "kilometers" }); // ~100m due east
    const line: LineStringGeoJSON = {
      type: "LineString",
      coordinates: [start.geometry.coordinates as [number, number], end.geometry.coordinates as [number, number]],
    };

    const points = samplePointsAlongStreets([line], 20, BIG_BOX);

    // A 100m line sampled every 20m yields points at 0,20,40,60,80,100 = 6.
    expect(points.length).toBe(6);
    expect(points[0].lat).toBeCloseTo(37.775, 3);
    expect(points[points.length - 1].lng).toBeCloseTo(end.geometry.coordinates[0], 3);
  });

  it("dedupes points that fall within 1 meter of each other across overlapping lines", () => {
    const shared: LineStringGeoJSON = {
      type: "LineString",
      coordinates: [
        [-122.42, 37.775],
        [-122.4198, 37.775],
      ],
    };
    // Same line supplied twice, simulating two overlapping ways from Overpass.
    const points = samplePointsAlongStreets([shared, shared], 20, BIG_BOX);
    const uniqueKeys = new Set(points.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`));
    expect(uniqueKeys.size).toBe(points.length);
  });

  it("returns an empty array for an empty input", () => {
    expect(samplePointsAlongStreets([], 20, BIG_BOX)).toEqual([]);
  });

  it("drops sampled points that fall outside the drawn polygon, even when the street itself dips inside it", () => {
    // A small square polygon...
    const polygon: [number, number][] = [
      [0, 0],
      [0, 0.001],
      [0.001, 0.001],
      [0.001, 0],
      [0, 0],
    ];
    // ...and a long street that only clips one corner of it (Overpass returns
    // the WHOLE way, not just the part inside the polygon).
    const longStreetThroughOneCorner: LineStringGeoJSON = {
      type: "LineString",
      coordinates: [
        [-0.05, 0.0005], // far outside, west of the polygon
        [0.0005, 0.0005], // inside the polygon
        [0.05, 0.0005], // far outside, east of the polygon
      ],
    };

    const points = samplePointsAlongStreets([longStreetThroughOneCorner], 20, polygon);

    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(p.lng).toBeGreaterThanOrEqual(0);
      expect(p.lng).toBeLessThanOrEqual(0.001);
    }
  });
});