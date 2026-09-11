/** La paleta de proveedores. Es el ÚNICO sitio de toda la aplicación donde el
 *  color codifica una categoría, y es deliberado: muchos orígenes simultáneos
 *  no se distinguen de otra forma. Fuera de la capa de disponibilidad y de los
 *  puntos índice de 9 px que la referencian, la rampa vuelve a ser neutra.
 *
 *  `monumentos` y `panoramax` faltaban aquí desde que se dieron de alta en
 *  `origins::registro()` — sin entrada caían al gris por defecto y al `id`
 *  crudo como nombre, detectado al escribir el spec de 2026-09-11. */
export const PALETA: Record<string, string> = {
  mapillary: "#4ec9a5",
  kartaview: "#a78bfa",
  google: "#e8b04b",
  "mapbox-satelite": "#4a4d52",
  commons: "#6ea8fe",
  flickr: "#f472a6",
  monumentos: "#c9a86a",
  panoramax: "#6ec9c2",
  wikipedia: "#f2c14e",
  "wms-orto": "#7a8b99",
  inaturalist: "#8bc670",
  geograph: "#e0956b",
  openaerialmap: "#9aa5f0",
};

export const NOMBRES: Record<string, string> = {
  mapillary: "Mapillary",
  kartaview: "KartaView",
  google: "Google Street View",
  "mapbox-satelite": "Mapbox Satellite",
  commons: "Wikimedia Commons",
  flickr: "Flickr",
  monumentos: "Wikidata → Commons",
  panoramax: "Panoramax",
  wikipedia: "Wikipedia",
  "wms-orto": "Ortofoto nacional (WMS)",
  inaturalist: "iNaturalist",
  geograph: "Geograph (UK/IE)",
  openaerialmap: "OpenAerialMap",
};

export const nombre = (id: string) => NOMBRES[id] ?? id;
export const color = (id: string) => PALETA[id] ?? "#6a6c70";

export const LIMITES: Record<string, string> = {
  mapillary: "8 req/s · 4 a la vez",
  kartaview: "4 req/s · 2 a la vez",
  google: "10 req/s · 4 a la vez",
  "mapbox-satelite": "16 req/s · 8 a la vez",
  commons: "2 req/s · 1 a la vez",
  flickr: "4 req/s · 2 a la vez",
  monumentos: "2 req/s · 1 a la vez",
  // 2 req/s · 1 a la vez es lo que `Ctx::nuevo` de panoramax.rs realmente usa
  // (verificado con grep antes de este Step) — el plan traía "4 req/s · 2 a
  // la vez" para esta fila, que no coincide con el código; se corrige aquí.
  panoramax: "2 req/s · 1 a la vez",
  wikipedia: "2 req/s · 1 a la vez",
  "wms-orto": "2 req/s · 1 a la vez",
  inaturalist: "1 req/s · 1 a la vez",
  geograph: "2 req/s · 1 a la vez",
  openaerialmap: "4 req/s · 2 a la vez",
};

/** Los que funcionan sin credencial. No se les pide una que no existe. */
export const SIN_CLAVE = new Set([
  "kartaview", "commons", "monumentos", "panoramax",
  "wikipedia", "wms-orto", "inaturalist", "geograph", "openaerialmap",
]);

/** Ninguno comparte clave con otro: cada proveedor tiene su propia fila,
 *  incluido Mapbox Satellite frente al mapa base (que no es un "origen" de
 *  indexado y por eso no está en `ORDEN` — vive aparte en `OriginsPanel`). */
export const COMPARTE_CLAVE = new Set<string>();

export const ORDEN = [
  "mapillary", "kartaview", "google", "mapbox-satelite", "commons",
  "monumentos", "wikipedia", "panoramax", "inaturalist", "geograph",
  "openaerialmap", "flickr",
];
