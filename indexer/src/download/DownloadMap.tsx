import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";

import { api, type TeselaProgreso } from "../lib/api";
import { color } from "../lib/origenes";
import { teselaAPoligono } from "../lib/quadkey";

/** El mapa en vivo de la descarga: sin herramientas de dibujo, sin buscador,
 *  de solo lectura — aquí no se decide nada, solo se mira cómo se va llenando.
 *  Encuadra una vez, al llegar la primera lista de teselas, y no vuelve a
 *  moverse solo: si el operador se aleja para mirar un origen concreto, un
 *  recuadro no le va a arrancar la vista de las manos en cada sondeo. */
export function DownloadMap({ teselas }: { teselas: TeselaProgreso[] }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<mapboxgl.Map | null>(null);
  const encuadrado = useRef(false);

  useEffect(() => {
    let vivo = true;
    void api.mapboxClave().then((clave) => {
      if (!vivo || !clave || !contenedor.current) return;
      mapboxgl.accessToken = clave;
      const m = new mapboxgl.Map({
        container: contenedor.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: [0, 20],
        zoom: 1,
        interactive: true,
      });
      m.on("load", () => {
        m.addSource("teselas", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({
          id: "teselas-relleno",
          type: "fill",
          source: "teselas",
          paint: {
            "fill-color": ["get", "color"],
            "fill-opacity": ["match", ["get", "estado"], "hecha", 0.55, 0.06],
          },
        });
        m.addLayer({
          id: "teselas-borde",
          type: "line",
          source: "teselas",
          paint: {
            "line-color": ["get", "color"],
            "line-width": 1,
            "line-opacity": ["match", ["get", "estado"], "hecha", 0.9, 0.25],
          },
        });
      });
      mapa.current = m;
    });
    return () => { vivo = false; mapa.current?.remove(); };
  }, []);

  // Mapbox GL no se entera solo de que su contenedor cambió de tamaño — y
  // este contenedor sí cambia: cambiar de pestaña en `Rail` desmonta y
  // remonta esta vista mientras el layout de alrededor (la franja de
  // embebido, el propio panel) todavía se está asentando, así que el mapa
  // se inicializaba a veces contra un contenedor transitorio y se quedaba
  // encogido para siempre (#64). Un `ResizeObserver` es más robusto que un
  // `setTimeout` de una sola vez: reacciona a cualquier cambio real de
  // tamaño, no solo al primero.
  useEffect(() => {
    if (!contenedor.current) return;
    const ro = new ResizeObserver(() => mapa.current?.resize());
    ro.observe(contenedor.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const m = mapa.current;
    if (!m || !m.isStyleLoaded() || teselas.length === 0) return;
    const src = m.getSource("teselas") as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    // Una tesela por fuente: si dos orígenes cubren la misma, se pintan las
    // dos superpuestas — es justo lo que hay que ver cuando se solapan.
    src.setData({
      type: "FeatureCollection",
      features: teselas.map((t) => {
        const f = teselaAPoligono(t.quadkey);
        f.properties = { estado: t.hecha ? "hecha" : "pendiente", color: color(t.fuente) };
        return f;
      }),
    });

    if (!encuadrado.current) {
      encuadrado.current = true;
      const caja = new mapboxgl.LngLatBounds();
      for (const t of teselas) {
        for (const anillo of teselaAPoligono(t.quadkey).geometry.coordinates) {
          for (const [lng, lat] of anillo) caja.extend([lng, lat]);
        }
      }
      m.fitBounds(caja, { padding: 40, duration: 0, maxZoom: 15 });
    }
  }, [teselas]);

  return <div ref={contenedor} className="h-full w-full" />;
}
