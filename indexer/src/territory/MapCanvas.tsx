import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";

import { api, type Clasificacion, type Punto, type SondeoTesela } from "../lib/api";
import { color } from "../lib/origenes";

/** Ease-out cúbico, la misma curva que MapCanvas del subsistema 6, para que
 *  los vuelos se sientan igual en las dos aplicaciones. Nunca `essential`:
 *  eso pisa el «reducir movimiento» del sistema operativo. */
const EASE_OUT_CUBIC = (t: number) => 1 - Math.pow(1 - t, 3);

/** Minimal, sin arrastrar los tipos de `geojson`: aquí solo hace falta un
 *  polígono con propiedades, no el estándar entero. */
interface Poligono {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "Polygon"; coordinates: number[][][] };
}

function poligonoGeoJSON(puntos: Punto[]): Poligono {
  const anillo = puntos.map((p) => [p.lng, p.lat]);
  if (anillo.length > 0) anillo.push(anillo[0]);
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [anillo] },
  };
}

/** El centro de una tesela z14 a partir de su quadkey, para dibujar su
 *  cuadrado en el mapa. Mismo entrelazado que `tiles::quadkey_de`, a la
 *  inversa. */
function teselaAPoligono(qk: string): Poligono {
  let x = 0, y = 0;
  for (const c of qk) {
    const d = c.charCodeAt(0) - 48;
    x = (x << 1) | (d & 1);
    y = (y << 1) | ((d >> 1) & 1);
  }
  const escala = 1 << qk.length;
  const lngDe = (tx: number) => (tx / escala) * 360 - 180;
  const latDe = (ty: number) => {
    const n = Math.PI * (1 - (2 * ty) / escala);
    return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
  };
  const anillo = [
    [lngDe(x), latDe(y)],
    [lngDe(x + 1), latDe(y)],
    [lngDe(x + 1), latDe(y + 1)],
    [lngDe(x), latDe(y + 1)],
    [lngDe(x), latDe(y)],
  ];
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [anillo] } };
}

export function MapCanvas({
  dibujo,
  clasificacion,
  onPoligonoListo,
  activos,
  sondeos,
  tokenMapillary,
}: {
  dibujo: Punto[];
  clasificacion: Clasificacion | null;
  onPoligonoListo: (p: Punto[]) => void;
  activos?: Set<string>;
  sondeos?: SondeoTesela[];
  tokenMapillary?: string | null;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<mapboxgl.Map | null>(null);
  const puntos = useRef<Punto[]>([]);
  // `null` mientras se pregunta, `false` cuando se sabe que no hay clave. Sin
  // este estado el mapa se quedaba en un `<div>` vacío para siempre y nadie
  // decía por qué: exactamente el fallo silencioso que PRODUCT.md prohíbe.
  const [hayClave, setHayClave] = useState<boolean | null>(null);

  useEffect(() => {
    let vivo = true;
    void api.mapboxClave().then((clave) => {
      if (!vivo) return;
      setHayClave(!!clave);
      if (!clave || !contenedor.current) return;
      mapboxgl.accessToken = clave;
      const m = new mapboxgl.Map({
        container: contenedor.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: [-8.4115, 43.3623],
        zoom: 12,
      });
      m.on("load", () => {
        m.addSource("dibujo", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "dibujo-relleno", type: "fill", source: "dibujo",
          paint: { "fill-color": "rgba(55,138,221,.07)" } });
        m.addLayer({ id: "dibujo-borde", type: "line", source: "dibujo",
          paint: { "line-color": "#85b7eb", "line-width": 1.6 } });

        m.addSource("teselas", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({
          id: "teselas-relleno", type: "fill", source: "teselas",
          paint: {
            "fill-color": [
              "match", ["get", "estado"],
              "local", "rgba(232,232,230,.13)",
              "catalogo", "rgba(55,138,221,.15)",
              "rgba(255,255,255,.015)", // nuevo
            ],
          },
        });
        m.addLayer({
          id: "teselas-borde", type: "line", source: "teselas",
          paint: {
            "line-color": "rgba(255,255,255,.2)",
            // El punteado es SOLO para lo nuevo: una tesela sin indexar es
            // una ausencia, no una advertencia. El ámbar queda para el
            // bloqueo, no para esto.
            "line-dasharray": ["match", ["get", "estado"], "nuevo", ["literal", [2, 2]], ["literal", [1, 0]]],
          },
        });

        // Mapillary por sus teselas vectoriales oficiales: una petición por
        // tesela de pantalla, gratis, y ya vienen cacheadas. No pasa por el
        // backend, así que Rust no tiene que decodificar nada.
        //
        // La URL vive aquí y solo aquí: estas teselas las pide el navegador
        // directamente a Mapillary, nunca el backend, así que una constante
        // en Rust solo sería una segunda copia que se desincroniza.
        if (tokenMapillary) {
          m.addSource("mly", {
            type: "vector",
            tiles: [`https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=${tokenMapillary}`],
            minzoom: 6,
            maxzoom: 14,
          });
          m.addLayer({
            id: "mly-puntos",
            type: "circle",
            source: "mly",
            "source-layer": "image",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 16, 2.6],
              "circle-color": "#4ec9a5",
              "circle-opacity": 0.9,
            },
          });
        }

        // El sombreado de los que solo se pueden sondear por muestreo. Una
        // sola fuente para todos: el color sale de la propiedad `fuente` de
        // cada rasgo, así que encender un origen más no añade una capa más.
        m.addSource("sondeos", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({
          id: "sondeos-relleno",
          type: "fill",
          source: "sondeos",
          paint: {
            "fill-color": ["get", "color"],
            "fill-opacity": ["match", ["get", "nivel"], "mucho", 0.30, "poco", 0.13, 0],
          },
        }, "teselas-borde");

        m.on("click", (e) => {
          puntos.current = [...puntos.current, { lat: e.lngLat.lat, lng: e.lngLat.lng }];
          (m.getSource("dibujo") as mapboxgl.GeoJSONSource)?.setData({
            type: "FeatureCollection",
            features: puntos.current.length >= 3 ? [poligonoGeoJSON(puntos.current)] : [],
          });
        });
        m.on("dblclick", (e) => {
          e.preventDefault();
          if (puntos.current.length >= 3) onPoligonoListo(puntos.current);
        });
      });
      mapa.current = m;
    });
    return () => { vivo = false; mapa.current?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const src = mapa.current?.getSource("teselas") as mapboxgl.GeoJSONSource | undefined;
    if (!src || !clasificacion) return;
    src.setData({
      type: "FeatureCollection",
      features: clasificacion.teselas.map(([qk, e]) => {
        const f = teselaAPoligono(qk);
        f.properties = { estado: e.estado };
        return f;
      }),
    });
  }, [clasificacion]);

  useEffect(() => {
    if (dibujo.length === 0) puntos.current = [];
  }, [dibujo]);

  useEffect(() => {
    const m = mapa.current;
    if (!m || !m.isStyleLoaded()) return;
    if (m.getLayer("mly-puntos")) {
      m.setLayoutProperty("mly-puntos", "visibility", activos?.has("mapillary") ? "visible" : "none");
    }
    const src = m.getSource("sondeos") as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    // Mapillary ya se pinta como puntos y el cenital no se pinta: los dos
    // quedan fuera del sombreado, o taparían a los demás con una capa que no
    // dice nada.
    src.setData({
      type: "FeatureCollection",
      features: (sondeos ?? [])
        .filter((s) => activos?.has(s.fuente) && s.fuente !== "mapillary" && s.fuente !== "mapbox-satelite")
        .map((s) => {
          const f = teselaAPoligono(s.quadkey);
          f.properties = { nivel: s.nivel, color: color(s.fuente) };
          return f;
        }),
    });
  }, [activos, sondeos]);

  // El motivo real, no un mapa en blanco: sin clave no hay teselas que pedir,
  // y quien lo lee tiene que saber exactamente dónde se arregla.
  if (hayClave === false) {
    return (
      <div className="grid h-full w-full place-items-center bg-surface">
        <div className="max-w-[340px] text-center">
          <p className="text-[12px] text-fg">El mapa necesita una clave de Mapbox</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            Sin ella no se pueden pedir las teselas del mapa base, así que no hay dónde dibujar
            el territorio. Se configura en Ajustes, pestaña «Orígenes de red».
          </p>
          <p className="mt-2 font-mono text-[9.5px] text-subtle">
            la misma clave sirve para el mapa y para el origen cenital
          </p>
        </div>
      </div>
    );
  }

  return <div ref={contenedor} className="h-full w-full" />;
}

/** Vuelo con la misma curva que el cliente, para que el gesto se sienta igual
 *  en las dos aplicaciones. Se expone aparte porque no todo vuelo nace de un
 *  clic del operador (p. ej. centrar tras cargar un índice). */
export function volarA(m: mapboxgl.Map, centro: [number, number], zoom: number) {
  m.easeTo({ center: centro, zoom, duration: 900, easing: EASE_OUT_CUBIC });
}
