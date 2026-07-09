// apps/web/app/api/geocode/route.ts
import { NextResponse } from "next/server";
import { getSettingsRepo } from "../../../lib/settings-repo";
import {
  formatMapboxLabel,
  formatNominatimLabel,
  type MapboxFeature,
  type NominatimAddress,
} from "../../lib/geocode-label";

// Coordinates snap to ~4 decimals (~11m) for cache keys — plenty for a
// city-level label and keeps the cache from exploding across near-identical
// points from the same pano cluster.
const cache = new Map<string, string | null>();
const key = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

async function geocodeMapbox(lat: number, lng: number, token: string): Promise<string | null> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=place,region,country&access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const body = (await res.json()) as { features?: MapboxFeature[] };
  const f = body.features?.[0];
  return f ? formatMapboxLabel(f) : null;
}

async function geocodeNominatim(lat: number, lng: number): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=10`;
  // Nominatim's usage policy requires a descriptive User-Agent — same lesson
  // as Overpass; omitting it gets requests blocked.
  const res = await fetch(url, {
    headers: { "user-agent": "netryx-lumi/0.1 (+https://github.com/netryx-fork)" },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { address?: NominatimAddress };
  return body.address ? formatNominatimLabel(body.address) : null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  const k = key(lat, lng);
  if (cache.has(k)) return NextResponse.json({ label: cache.get(k) });

  const token = (await getSettingsRepo().getSetting("MAPBOX_TOKEN")) || null;
  let label: string | null = null;
  try {
    label = token ? await geocodeMapbox(lat, lng, token) : await geocodeNominatim(lat, lng);
  } catch {
    label = null; // geocoding is best-effort; the UI falls back to raw coords
  }
  cache.set(k, label);
  return NextResponse.json({ label });
}