/** La paleta de proveedores. Es el ÚNICO sitio de toda la aplicación donde el
 *  color codifica una categoría, y es deliberado: cinco orígenes simultáneos no
 *  se distinguen de otra forma. Fuera de la capa de disponibilidad y de los
 *  puntos índice de 9 px que la referencian, la rampa vuelve a ser neutra. */
export const PALETA: Record<string, string> = {
  mapillary: "#4ec9a5",
  kartaview: "#a78bfa",
  google: "#e8b04b",
  "mapbox-satelite": "#4a4d52",
  commons: "#6ea8fe",
  flickr: "#f472a6",
};

export const NOMBRES: Record<string, string> = {
  mapillary: "Mapillary",
  kartaview: "KartaView",
  google: "Google Street View",
  "mapbox-satelite": "Mapbox Satellite",
  commons: "Wikimedia Commons",
  flickr: "Flickr",
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
};

/** Los dos que funcionan sin credencial. No se les pide una que no existe. */
export const SIN_CLAVE = new Set(["kartaview", "commons"]);

/** Ninguno comparte clave con otro: cada proveedor tiene su propia fila,
 *  incluido Mapbox Satellite frente al mapa base (que no es un "origen" de
 *  indexado y por eso no está en `ORDEN` — vive aparte en `OriginsPanel`). */
export const COMPARTE_CLAVE = new Set<string>();

export const ORDEN = [
  "mapillary", "kartaview", "google", "mapbox-satelite", "commons", "flickr",
];
