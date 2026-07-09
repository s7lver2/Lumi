// packages/geo-sampling/src/sample.test.ts
import { describe, it, expect } from "vitest";
import * as turf from "@turf/turf";
import { samplePointsAlongStreets } from "./sample";
import type { LineStringGeoJSON } from "./overpass";

describe("samplePointsAlongStreets", () => {
  it("samples points every ~spacingMeters along a single straight line", () => {
    const start = turf.point([-122.42, 37.775]);
    const end = turf.destination(start, 0.1, 90, { units: "kilometers" }); // ~100m due east
    const line: LineStringGeoJSON = {
      type: "LineString",
      coordinates: [start.geometry.coordinates as [number, number], end.geometry.coordinates as [number, number]],
    };

    const points = samplePointsAlongStreets([line], 20);

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
    const points = samplePointsAlongStreets([shared, shared], 20);
    const uniqueKeys = new Set(points.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`));
    expect(uniqueKeys.size).toBe(points.length);
  });

  it("returns an empty array for an empty input", () => {
    expect(samplePointsAlongStreets([], 20)).toEqual([]);
  });
});