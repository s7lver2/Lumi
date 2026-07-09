// apps/web/app/lib/geo.ts
import * as turf from "@turf/turf";

/** Closed GeoJSON polygon ([lng,lat] ring, first==last) from a draw ring. */
export function ringToPolygon(ring: [number, number][]): GeoJSON.Feature<GeoJSON.Polygon> {
  const closed =
    ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])
      ? [...ring, ring[0]]
      : ring;
  return turf.polygon([closed]);
}

/** Area of a [lng,lat] ring in km² (turf.area returns m²). */
export function polygonAreaKm2(ring: [number, number][]): number {
  if (ring.length < 4) return 0;
  try {
    return turf.area(ringToPolygon(ring)) / 1_000_000;
  } catch {
    return 0;
  }
}