import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MapConfig } from "../lib/api";
import { lumiUrl } from "../lib/bridge";

/** mapbox-gl es descendiente directo de maplibre-gl: comparten API en todo lo
 *  que este subsistema usa (cámara, fuentes, capas, marcadores, eventos). Se
 *  escriben los tipos contra MapLibre y el otro se adapta con un `as`, en vez
 *  de duplicar el componente entero por una diferencia que no existe. */
export type AnyMap = maplibregl.Map;
export interface Gl {
  Marker: typeof maplibregl.Marker;
  LngLatBounds: typeof maplibregl.LngLatBounds;
}

export interface Motor {
  map: AnyMap;
  gl: Gl;
}

/** Monta el mapa con el motor que el administrador haya elegido.
 *
 *  Los dos caminos son distintos de verdad, no dos formas de hacer lo mismo:
 *
 *  - **maplibre** habla solo con nuestro daemon. El estilo llega ya reescrito
 *    (`/v1/map/style`) y teselas, tipografías e iconos van por rutas nuestras,
 *    así que la clave del proveedor no sale del servidor.
 *  - **mapbox** habla directamente con la API de Mapbox con la clave puesta en
 *    el navegador. A cambio dibuja sus estilos tal cual los diseñan ellos y
 *    trae su globo y su iluminación. El daemon no ve ni una petición.
 *
 *  El SDK de Mapbox se carga bajo demanda: si nadie enciende ese motor, sus
 *  ~800 KB no entran en el paquete que se abre al arrancar. */
export async function createMap(
  cfg: MapConfig, container: HTMLDivElement, globe: boolean,
): Promise<Motor> {
  const projection = globe ? "globe" : "mercator";

  if (cfg.engine === "mapbox" && cfg.key && cfg.style) {
    const mapboxgl = (await import("mapbox-gl")).default;
    await import("mapbox-gl/dist/mapbox-gl.css");
    mapboxgl.accessToken = cfg.key;
    const m = new mapboxgl.Map({
      container,
      style: cfg.style,
      center: [0, 20],
      zoom: 1.4,
      maxPitch: 70,
      projection,
      // El logotipo de Mapbox es un control aparte y se queda: su licencia lo
      // exige. Lo que se va es la línea de texto de atribución, que aquí
      // taparía el dock.
      attributionControl: false,
    });
    return {
      map: m as unknown as AnyMap,
      gl: mapboxgl as unknown as Gl,
    };
  }

  const res = await fetch(lumiUrl("/v1/map/style"));
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body || `el proveedor de mapas devolvió ${res.status}`);
  }
  const style: StyleSpecification = await res.json();
  // La proyección es parte del estilo en MapLibre 5, no una opción del mapa.
  (style as StyleSpecification & { projection?: unknown }).projection = { type: projection };

  const m = new maplibregl.Map({
    container,
    style,
    // Las rutas del estilo reescrito son relativas; el puente nativo las
    // resuelve contra el daemon sin que el webview vea el certificado.
    transformRequest: (url) => (url.startsWith("/v1/") ? { url: lumiUrl(url) } : { url }),
    center: [0, 20],
    zoom: 1.4,
    maxPitch: 70,
    attributionControl: { compact: true },
    // El estilo sale de un catálogo cerrado de estilos oficiales y el daemon ya
    // comprobó su forma en `rewrite()`. El validador de MapLibre es más
    // estricto que el propio Mapbox con campos de sus estilos oficiales.
    validateStyle: false,
  });
  return { map: m, gl: maplibregl };
}
