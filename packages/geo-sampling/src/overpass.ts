// packages/geo-sampling/src/overpass.ts
export interface LineStringGeoJSON {
  type: "LineString";
  coordinates: [number, number][];
}

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

// The free public overpass-api.de instance is shared infrastructure and
// frequently returns transient gateway errors under load (504 confirmed live
// during manual testing of /api/areas after /api/areas/estimate succeeded
// moments earlier against the same polygon). These codes are worth a retry;
// anything else (4xx, malformed query) is not. 429 (rate limit — confirmed
// live: "Overpass request failed (429)" when the worker retried indexing
// shortly after a prior request) is also retryable, since it's Overpass
// asking the client to slow down, not a malformed query.
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

function buildQuery(polygon: [number, number][]): string {
  // Overpass "poly" filter wants "lat1 lon1 lat2 lon2 ..." (lat first).
  const poly = polygon.map(([lng, lat]) => `${lat} ${lng}`).join(" ");
  return `
    [out:json][timeout:60];
    way["highway"](poly:"${poly}");
    out geom;
  `.trim();
}

async function postOverpassQuery(query: string): Promise<Response> {
  // overpass-api.de's front proxy returns 406 Not Acceptable for requests with
  // no (or a generic) User-Agent — confirmed directly against the live
  // endpoint: identical request succeeds with a descriptive UA and fails
  // without one. This is also what Overpass's own usage policy asks clients
  // to send. Form-encoding the query in a `data` field matches the shape
  // Overpass's own curl/wget examples use.
  return fetch(OVERPASS_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "netryx-lumi/0.1 (+https://github.com/netryx-fork)",
    },
    body: new URLSearchParams({ data: query }).toString(),
  });
}

export interface FetchStreetGeometryOptions {
  retries?: number;
  retryBaseDelayMs?: number;
}

/**
 * Queries Overpass for all `highway=*` ways inside `polygon` and returns them
 * as GeoJSON LineStrings ([lng, lat] order) ready for turf.js (spec §4 step 2).
 * Retries with exponential backoff on transient gateway errors (502/503/504)
 * — the public Overpass instance is shared infrastructure and intermittently
 * overloaded; anything else fails immediately.
 */
export async function fetchStreetGeometry(
  polygon: [number, number][],
  options: FetchStreetGeometryOptions = {}
): Promise<LineStringGeoJSON[]> {
  const retries = options.retries ?? 2;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
  const query = buildQuery(polygon);

  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await postOverpassQuery(query);
    if (res.ok || !RETRYABLE_STATUS_CODES.has(res.status) || attempt >= retries) {
      break;
    }
    // Overpass sends Retry-After (seconds) on 429s telling clients exactly how
    // long to back off — honor it when present instead of guessing with the
    // default exponential delay, which is tuned for 502/503/504, not rate limits.
    const retryAfterSeconds = Number(res.headers?.get?.("retry-after"));
    const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : retryBaseDelayMs * 2 ** attempt;
    await new Promise((r) => setTimeout(r, delayMs));
  }

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