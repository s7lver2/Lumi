import type { Map as MapLibreMap } from "maplibre-gl";

/** Los edificios en 3D vienen del mismo tileset vectorial que ya se está
 *  descargando: no es una capa extra que pedir, es una capa que dibujar. Lo
 *  que cambia entre proveedores son los nombres —la fuente, la capa de origen
 *  y los campos de altura—, y por eso están aquí en un solo sitio.
 *
 *  Portado de la v1 (`apps/web/app/lib/map-buildings.ts`), que ya resolvía
 *  exactamente esto. */
export function addBuildings(map: MapLibreMap, provider: string) {
  const mapbox = provider === "mapbox";
  const source = mapbox ? "composite" : "openmaptiles";
  const alto = mapbox ? "height" : "render_height";
  const base = mapbox ? "min_height" : "render_min_height";

  // Un estilo que no traiga esa fuente no es un error: es un tema sin
  // edificios. Añadir la capa igualmente la dejaría muerta y ensuciaría la
  // consola con avisos de MapLibre en cada render.
  if (!map.getSource(source) || map.getLayer("lumi-3d")) return;

  map.addLayer({
    id: "lumi-3d",
    type: "fill-extrusion",
    source,
    "source-layer": "building",
    minzoom: 14,
    paint: {
      "fill-extrusion-color": "#2a2d31",
      "fill-extrusion-height": ["coalesce", ["get", alto], 0],
      "fill-extrusion-base": ["coalesce", ["get", base], 0],
      // Aparecen fundiéndose entre el zoom 14 y el 15 en vez de saltar a la
      // vista de golpe cuando cruzas el umbral.
      "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0, 15, 0.85],
    },
  });
}
