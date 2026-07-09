// packages/geo-sampling/src/sample.ts
import * as turf from "@turf/turf";
import type { LineStringGeoJSON } from "./overpass";
import type { SampledPoint } from "@netryx/shared-types";

/**
 * Samples a point every `spacingMeters` along each line, then dedupes points
 * that land within 1m of each other — overlapping Overpass "ways" (e.g. a
 * road split into two segments that share a stretch) would otherwise produce
 * near-duplicate capture points (spec §4 step 2).
 */
export function samplePointsAlongStreets(
  lines: LineStringGeoJSON[],
  spacingMeters: number
): SampledPoint[] {
  const seen = new Set<string>();
  const points: SampledPoint[] = [];

  for (const line of lines) {
    if (line.coordinates.length < 2) continue;

    const feature = turf.lineString(line.coordinates);
    const lengthMeters = turf.length(feature, { units: "kilometers" }) * 1000;

    for (let d = 0; d <= lengthMeters; d += spacingMeters) {
      const along = turf.along(feature, d / 1000, { units: "kilometers" });
      const [lng, lat] = along.geometry.coordinates;
      const key = `${lat.toFixed(5)},${lng.toFixed(5)}`; // ~1m precision at these latitudes
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({ lat, lng });
    }
  }

  return points;
}