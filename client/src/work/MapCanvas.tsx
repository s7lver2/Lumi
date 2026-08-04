import { useEffect, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api, type MapConfig } from "../lib/api";
import { lumiUrl } from "../lib/bridge";
import { useServer } from "../lib/store";
import { Icon } from "../ui/Icon";

export interface Marker {
  id: string;
  lat: number;
  lng: number;
  label: string;
  /** `top` el principal, `alt` otro resultado, `exif` el GPS declarado por la
   *  cámara, `off` un análisis sin resolver todavía. */
  kind: "top" | "alt" | "exif" | "off";
  radiusM?: number;
}

const COLOR = {
  top: { bg: "#f2f3f5", fg: "#000", border: "#f2f3f5" },
  alt: { bg: "#101215", fg: "#e8e8e6", border: "rgba(255,255,255,.22)" },
  exif: { bg: "#101215", fg: "#efb968", border: "#efb968" },
  off: { bg: "#101215", fg: "#6a6c70", border: "#3a3e44" },
} as const;

/** Anillo de 64 puntos que aproxima un círculo de `radiusM` metros. La
 *  corrección por coseno de la latitud es lo que evita que salga un óvalo
 *  cuanto más al norte estés. */
function ring(lat: number, lng: number, radiusM: number): [number, number][] {
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: 65 }, (_, i) => {
    const t = (i / 64) * 2 * Math.PI;
    return [lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)] as [number, number];
  });
}

function el(m: Marker): HTMLElement {
  const c = COLOR[m.kind];
  const d = document.createElement("div");
  d.textContent = m.label;
  d.title = m.kind === "exif" ? "GPS declarado por la cámara" : m.label;
  d.style.cssText = `width:22px;height:22px;border-radius:50%;display:flex;
    align-items:center;justify-content:center;font-size:11px;cursor:pointer;
    background:${c.bg};color:${c.fg};border:1px solid ${c.border};
    ${m.kind === "off" ? "border-style:dashed;" : ""}`;
  return d;
}

export function MapCanvas({
  markers, onMarker, flyTo,
}: {
  markers: Marker[];
  onMarker?: (id: string) => void;
  flyTo?: { lat: number; lng: number; zoom: number } | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const placed = useRef<maplibregl.Marker[]>([]);
  const [reason, setReason] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // `/v1/map/config` exige sesión como todas las rutas del daemon. Iba sin
  // token, así que el mapa contestaba siempre "sesión inválida" y el lienzo
  // no llegaba ni a construirse: no era un problema del proveedor, era esta
  // llamada. Las teselas y el estilo sí iban firmados, porque van por el
  // puente nativo `lumi://`, que lleva el token en su propio estado.
  const token = useServer((s) => s.token) ?? undefined;

  useEffect(() => {
    let dead = false;
    (async () => {
      const cfg = await api.get<MapConfig>("/v1/map/config", token).catch((e) => {
        setReason(String(e));
        return null;
      });
      if (dead || !box.current) return;
      if (!cfg) return;
      // Nada de lienzo en blanco ni de spinner eterno: si no hay proveedor,
      // se dice quién tiene que arreglarlo.
      if (cfg.reason) { setReason(cfg.reason); return; }
      setReason(null);

      // El estilo se pide a mano ANTES de dárselo a MapLibre. Si se lo pasas
      // como URL (`style: lumiUrl(...)`) y el daemon contesta un error, lo
      // único que llega es un `AJAXError: Bad Gateway` sin cuerpo: MapLibre no
      // expone el texto de la respuesta, solo el código. El daemon sí explica
      // el motivo real en ese cuerpo (por ejemplo, que la URL configurada es
      // la página de vista previa de Mapbox Studio y no el estilo en JSON), y
      // ese motivo es justo el que hay que enseñar.
      let style: StyleSpecification;
      try {
        const res = await fetch(lumiUrl("/v1/map/style"));
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          setReason(body || `el proveedor de mapas devolvió ${res.status}`);
          return;
        }
        style = await res.json();
      } catch (e) {
        setReason(`no se pudo pedir el estilo del mapa: ${String(e)}`);
        return;
      }
      if (dead || !box.current) return;

      const m = new maplibregl.Map({
        container: box.current,
        style,
        transformRequest: (url) =>
          url.startsWith("/v1/") ? { url: lumiUrl(url) } : { url },
        center: [0, 20],
        zoom: 1.4,
        attributionControl: { compact: true },
      });
      // Aparecer con un fundido en vez de un fogonazo de lienzo vacío: el
      // estilo tarda un instante en llegar y ese instante se veía en negro.
      m.once("load", () => setReady(true));
      // MapLibre avisa aquí de un estilo o unas teselas que no cargan. Sin
      // esto el mapa se quedaba en negro sin decir nada, que es justo lo que
      // este subsistema se prohíbe.
      m.on("error", (e) => {
        const msg = (e as { error?: { message?: string } }).error?.message;
        if (msg) setReason(`el mapa no se pudo cargar: ${msg}`);
      });
      map.current = m;
    })();
    return () => {
      dead = true;
      map.current?.remove();
      map.current = null;
    };
  }, [token]);

  // Los círculos de confianza van como polígono geográfico y no como
  // `circle-radius` en píxeles: el radio está en metros y tiene que seguir
  // siendo los mismos metros al hacer zoom, que es justo lo que un radio en
  // píxeles no hace.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const draw = () => {
      const data = {
        type: "FeatureCollection" as const,
        features: markers
          .filter((mk) => mk.radiusM && mk.radiusM > 0)
          .map((mk) => ({
            type: "Feature" as const,
            properties: {},
            geometry: { type: "Polygon" as const, coordinates: [ring(mk.lat, mk.lng, mk.radiusM!)] },
          })),
      };
      const src = m.getSource("conf") as maplibregl.GeoJSONSource | undefined;
      if (src) { src.setData(data); return; }
      m.addSource("conf", { type: "geojson", data });
      m.addLayer({
        id: "conf-fill", type: "fill", source: "conf",
        paint: { "fill-color": "#ffffff", "fill-opacity": 0.055 },
      });
      m.addLayer({
        id: "conf-line", type: "line", source: "conf",
        paint: { "line-color": "#ffffff", "line-opacity": 0.5, "line-width": 1 },
      });
    };
    if (m.isStyleLoaded()) draw();
    else m.once("load", draw);
  }, [markers]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    placed.current.forEach((p) => p.remove());
    placed.current = markers.map((mk) => {
      const marker = new maplibregl.Marker({ element: el(mk) })
        .setLngLat([mk.lng, mk.lat])
        .addTo(m);
      if (onMarker) marker.getElement().addEventListener("click", () => onMarker(mk.id));
      return marker;
    });
  }, [markers, onMarker]);

  useEffect(() => {
    if (flyTo && map.current) {
      map.current.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: flyTo.zoom, duration: 1400 });
    }
  }, [flyTo]);

  if (reason) {
    // Una franja bajo la barra superior, no un cartel centrado: centrado
    // competía por el mismo hueco que el destino de arrastre y la tarjeta de
    // resultado, que también se centran — las dos cosas a la vez se
    // solapaban en cualquier caso vacío sin proveedor de mapas configurado.
    return (
      <div className="absolute inset-0" style={{ background: "radial-gradient(120% 90% at 50% 35%, #16191d 0%, #0e0f11 70%)" }}>
        <div className="absolute left-11 right-0 top-[38px] z-10 flex items-start gap-2.5
          border-b border-border bg-[rgba(20,22,26,.72)] px-4 py-2.5 backdrop-blur"
          style={{ animation: "jg-fade-rise 260ms cubic-bezier(.16,1,.3,1) both" }}>
          <Icon name="globe" size={13} className="mt-px shrink-0 text-subtle" />
          <p className="text-[11px] leading-relaxed text-muted">
            <span className="text-fg">No hay mapa que dibujar. </span>{reason}
          </p>
        </div>
      </div>
    );
  }
  return (
    <>
      <div ref={box} className="absolute inset-0 transition-opacity duration-700 ease-expo"
        style={{ opacity: ready ? 1 : 0 }} />
      {!ready && (
        <div className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(120% 90% at 50% 35%, #16191d 0%, #0e0f11 70%)" }} />
      )}
    </>
  );
}
