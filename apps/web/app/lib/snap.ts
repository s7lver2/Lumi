// apps/web/app/lib/snap.ts
import * as turf from "@turf/turf";

/** Snaps a [lng,lat] point to the nearest point on any street line within thresholdMeters. */
export function snapPoint(
  point: [number, number],
  streets: [number, number][][],
  thresholdMeters: number
): [number, number] {
  const p = turf.point(point);
  let best: [number, number] = point;
  let bestDist = Infinity;
  for (const line of streets) {
    if (line.length < 2) continue;
    const snapped = turf.nearestPointOnLine(turf.lineString(line), p, { units: "meters" });
    const d = snapped.properties.dist ?? Infinity;
    if (d < bestDist) { bestDist = d; best = snapped.geometry.coordinates as [number, number]; }
  }
  return bestDist <= thresholdMeters ? best : point;
}