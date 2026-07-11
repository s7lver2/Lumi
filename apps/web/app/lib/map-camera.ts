// apps/web/app/lib/map-camera.ts
// Shared camera moves so "selecting a region" and "confirming a candidate"
// feel like two deliberately different gestures, not the same flyTo reused
// everywhere: selecting is a broad "let's look over here" (zoom 15, more
// tilt-forward feel via a gentler curve), confirming is a tight "here it
// is, precisely" swoop (zoom 17, longer duration, higher curve for more
// of a dramatic arc). Neither passes `essential: true` — that flag
// overrides the user's OS-level prefers-reduced-motion setting, which
// Mapbox/MapLibre otherwise already shortens/skips this animation for.

interface LatLng {
  lat: number;
  lng: number;
}

export function flyToRegion(map: any, region: { centroid: LatLng }): void {
  if (!map) return;
  map.flyTo({
    center: [region.centroid.lng, region.centroid.lat],
    zoom: 15,
    pitch: 50,
    duration: 1100,
    curve: 1.2,
  });
}

export function flyToPoint(map: any, point: LatLng): void {
  if (!map) return;
  map.flyTo({
    center: [point.lng, point.lat],
    zoom: 17,
    pitch: 60,
    duration: 1400,
    curve: 1.5,
  });
}