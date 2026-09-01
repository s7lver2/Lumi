import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";

import { api } from "../lib/api";
import { teselaAPoligono } from "../lib/quadkey";

/** Dónde está el terreno que cubre una cuenta, a partir de sus quadkeys
 *  reales: un mapa Mapbox GL de verdad, mismo patrón que `DownloadMap`, en
 *  vez de la rejilla CSS sintética de antes — encuadra automáticamente sobre
 *  la extensión real de la cobertura para que la forma geográfica se vea. */
export function CoverageMap({ quadkeys }: { quadkeys: string[] }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<mapboxgl.Map | null>(null);
  const listo = useRef(false);

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
        m.addSource("cobertura", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({
          id: "cobertura-relleno",
          type: "fill",
          source: "cobertura",
          paint: { "fill-color": "rgba(133,183,235,1)", "fill-opacity": 0.45 },
        });
        m.addLayer({
          id: "cobertura-borde",
          type: "line",
          source: "cobertura",
          paint: { "line-color": "rgba(133,183,235,1)", "line-width": 1, "line-opacity": 0.8 },
        });
        listo.current = true;
        pintar(m);
      });
      mapa.current = m;
    });
    return () => { vivo = false; listo.current = false; mapa.current?.remove(); mapa.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pintar(m: mapboxgl.Map) {
    const src = m.getSource("cobertura") as mapboxgl.GeoJSONSource | undefined;
    if (!src || quadkeys.length === 0) return;
    src.setData({
      type: "FeatureCollection",
      features: quadkeys.map((qk) => teselaAPoligono(qk)),
    });
    const caja = new mapboxgl.LngLatBounds();
    for (const qk of quadkeys) {
      for (const anillo of teselaAPoligono(qk).geometry.coordinates) {
        for (const [lng, lat] of anillo) caja.extend([lng, lat]);
      }
    }
    m.fitBounds(caja, { padding: 30, duration: 0, maxZoom: 15 });
  }

  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo.current) return;
    pintar(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quadkeys]);

  if (quadkeys.length === 0) return null;
  return <div ref={contenedor} className="h-[220px] w-full overflow-hidden rounded-lg border border-border" />;
}
