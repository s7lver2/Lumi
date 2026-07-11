// apps/web/app/api/map-config/route.ts
import { NextResponse } from "next/server";
import { getSettingsRepo } from "../../../lib/settings-repo";

// OpenFreeMap "liberty" is free, keyless, and uses the OpenMapTiles schema —
// its `building` layer carries render_height/render_min_height, which is what
// makes 3D extrusion possible without a Mapbox token (spec §5.1).
const MAPLIBRE_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const MAPBOX_DARK_STYLE = "mapbox://styles/mapbox/dark-v11";

export async function GET() {
  // Reading MAPBOX_TOKEN decrypts a secret from system_settings; if that fails
  // (missing/rotated key file, DB hiccup) fall back to the free keyless
  // MapLibre config instead of throwing a 500 with an empty body — the map
  // must still render, and the client parses this response directly.
  try {
    const token = (await getSettingsRepo().getSetting("MAPBOX_TOKEN")) || null;
    if (token) {
      return NextResponse.json({ provider: "mapbox", styleUrl: MAPBOX_DARK_STYLE, mapboxToken: token });
    }
  } catch (err) {
    console.error("map-config: falling back to MapLibre (could not read MAPBOX_TOKEN):", err);
  }
  return NextResponse.json({ provider: "maplibre", styleUrl: MAPLIBRE_STYLE, mapboxToken: null });
}