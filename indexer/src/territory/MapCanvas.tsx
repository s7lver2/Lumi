import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";

import { api, type Clasificacion, type Punto } from "../lib/api";

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
}: {
  dibujo: Punto[];
  clasificacion: Clasificacion | null;
  onPoligonoListo: (p: Punto[]) => void;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<mapboxgl.Map | null>(null);
  const puntos = useRef<Punto[]>([]);

  useEffect(() => {
    let vivo = true;
    void api.mapboxClave().then((clave) => {
      if (!vivo || !clave || !contenedor.current) return;
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

  return <div ref={contenedor} className="h-full w-full" />;
}

/** Vuelo con la misma curva que el cliente, para que el gesto se sienta igual
 *  en las dos aplicaciones. Se expone aparte porque no todo vuelo nace de un
 *  clic del operador (p. ej. centrar tras cargar un índice). */
export function volarA(m: mapboxgl.Map, centro: [number, number], zoom: number) {
  m.easeTo({ center: centro, zoom, duration: 900, easing: EASE_OUT_CUBIC });
}
