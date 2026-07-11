// packages/geo-sampling/src/sample.ts
import * as turf from "@turf/turf";
import type { LineStringGeoJSON } from "./overpass";
import type { SampledPoint } from "@netryx/shared-types";

/**
 * Samples a point every `spacingMeters` along each line, then dedupes points
 * that land within 1m of each other — overlapping Overpass "ways" (e.g. a
 * road split into two segments that share a stretch) would otherwise produce
 * near-duplicate capture points (spec §4 step 2).
 *
 * `polygon` is REQUIRED and used to drop any sampled point that falls outside
 * the drawn area. Overpass's `way["highway"](poly:"...")` filter matches any
 * way that merely *intersects* the polygon but returns that way's FULL
 * geometry — a street that clips one corner of the drawn area comes back in
 * its entirety, so without this filter points get sampled kilometers outside
 * the area the user actually drew (confirmed live: dots appearing well
 * outside the rectangle, following real streets that extend past it).
 */
export function samplePointsAlongStreets(
  lines: LineStringGeoJSON[],
  spacingMeters: number,
  polygon: [number, number][]
): SampledPoint[] {
  const seen = new Set<string>();
  const points: SampledPoint[] = [];
  const closedPolygon =
    polygon.length > 0 &&
    (polygon[0][0] !== polygon[polygon.length - 1][0] || polygon[0][1] !== polygon[polygon.length - 1][1])
      ? [...polygon, polygon[0]]
      : polygon;
  const area = turf.polygon([closedPolygon]);

  for (const line of lines) {
    if (line.coordinates.length < 2) continue;

    const feature = turf.lineString(line.coordinates);
    const lengthMeters = turf.length(feature, { units: "kilometers" }) * 1000;

    for (let d = 0; d <= lengthMeters; d += spacingMeters) {
      const along = turf.along(feature, d / 1000, { units: "kilometers" });
      const [lng, lat] = along.geometry.coordinates;
      if (!turf.booleanPointInPolygon(along, area)) continue;
      const key = `${lat.toFixed(5)},${lng.toFixed(5)}`; // ~1m precision at these latitudes
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({ lat, lng });
    }
  }

  return points;
}