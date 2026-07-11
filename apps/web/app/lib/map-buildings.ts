// apps/web/app/lib/map-buildings.ts
// Adds a fill-extrusion buildings layer. The source-layer + height fields differ
// per provider, but both produce real 3D buildings (spec §5, design requirement).
export function addBuildingsLayer(map: any, provider: "mapbox" | "maplibre"): void {
  const isMapbox = provider === "mapbox";
  const sourceLayer = isMapbox ? "building" : "building";
  const heightField = isMapbox ? "height" : "render_height";
  const minHeightField = isMapbox ? "min_height" : "render_min_height";
  const source = isMapbox ? "composite" : "openmaptiles";

  if (map.getLayer("lumi-3d-buildings")) return;
  map.addLayer({
    id: "lumi-3d-buildings",
    type: "fill-extrusion",
    source,
    "source-layer": sourceLayer,
    minzoom: 14,
    paint: {
      "fill-extrusion-color": "#2a2d31",
      "fill-extrusion-height": ["coalesce", ["get", heightField], 0],
      "fill-extrusion-base": ["coalesce", ["get", minHeightField], 0],
      "fill-extrusion-opacity": 0.85,
    },
  });
}