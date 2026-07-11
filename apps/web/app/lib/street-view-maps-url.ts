// apps/web/app/lib/street-view-maps-url.ts

/**
 * Deep-links straight into Google Maps' Street View panorama viewer at the
 * EXACT pano + heading a candidate image was captured at — not just a plain
 * lat/lng pin, which would drop the user somewhere near the spot facing an
 * arbitrary direction. `map_action=pano` + `pano=<id>` + `heading` is Google
 * Maps' documented URL scheme for this (https://developers.google.com/maps/documentation/urls/get-started#pano-action).
 */
export function streetViewMapsUrl(panoId: string, heading: number): string {
  const params = new URLSearchParams({
    api: "1",
    map_action: "pano",
    pano: panoId,
    heading: String(heading),
    pitch: "0",
    fov: "80",
  });
  return `https://www.google.com/maps/@?${params.toString()}`;
}
