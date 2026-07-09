// packages/geo-sampling/src/overpass.ts
export interface LineStringGeoJSON {
  type: "LineString";
  coordinates: [number, number][];
}

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

function buildQuery(polygon: [number, number][]): string {
  // Overpass "poly" filter wants "lat1 lon1 lat2 lon2 ..." (lat first).
  const poly = polygon.map(([lng, lat]) => `${lat} ${lng}`).join(" ");
  return `
    [out:json][timeout:60];
    way["highway"](poly:"${poly}");
    out geom;
  `.trim();
}

/**
 * Queries Overpass for all `highway=*` ways inside `polygon` and returns them
 * as GeoJSON LineStrings ([lng, lat] order) ready for turf.js (spec §4 step 2).
 */
export async function fetchStreetGeometry(
  polygon: [number, number][]
): Promise<LineStringGeoJSON[]> {
  const res = await fetch(OVERPASS_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: buildQuery(polygon),
  });

  if (!res.ok) {
    throw new Error(`Overpass request failed (${res.status})`);
  }

  const body = (await res.json()) as {
    elements: Array<{
      type: string;
      geometry?: Array<{ lat: number; lon: number }>;
    }>;
  };

  return body.elements
    .filter((el) => el.type === "way" && el.geometry && el.geometry.length >= 2)
    .map((el) => ({
      type: "LineString" as const,
      coordinates: el.geometry!.map((pt) => [pt.lon, pt.lat] as [number, number]),
    }));
}