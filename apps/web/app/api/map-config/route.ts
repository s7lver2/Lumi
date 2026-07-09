// apps/web/app/api/map-config/route.ts
import { NextResponse } from "next/server";
import { getSettingsRepo } from "../../../lib/settings-repo";

// OpenFreeMap "liberty" is free, keyless, and uses the OpenMapTiles schema —
// its `building` layer carries render_height/render_min_height, which is what
// makes 3D extrusion possible without a Mapbox token (spec §5.1).
const MAPLIBRE_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const MAPBOX_DARK_STYLE = "mapbox://styles/mapbox/dark-v11";

export async function GET() {
  const token = (await getSettingsRepo().getSetting("MAPBOX_TOKEN")) || null;
  if (token) {
    return NextResponse.json({ provider: "mapbox", styleUrl: MAPBOX_DARK_STYLE, mapboxToken: token });
  }
  return NextResponse.json({ provider: "maplibre", styleUrl: MAPLIBRE_STYLE, mapboxToken: null });
}