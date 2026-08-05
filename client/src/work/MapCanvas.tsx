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
  /** `reason` es un fallo del que no se vuelve: no hay proveedor, o el estilo
   *  no llegó, y por tanto no hay lienzo que montar. */
  const [reason, setReason] = useState<string | null>(null);
  /** `warn` es un fallo de EN MARCHA: una tesela, una tipografía o un icono
   *  que no cargan con el mapa ya montado. Antes esto también borraba el mapa
   *  entero, así que un fallo de tipografías dejaba la pantalla en negro
   *  cuando las teselas estaban perfectamente. Ahora se avisa por encima y lo
   *  que sí ha cargado se sigue viendo. */
  const [warn, setWarn] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // `/v1/map/config` exige sesión como todas las rutas del daemon. Iba sin
  // token, así que el mapa contestaba siempre "sesión inválida" y el lienzo
  // no llegaba ni a construirse: no era un problema del proveedor, era esta
  // llamada. Las teselas y el estilo sí iban firmados, porque van por el
  // puente nativo `lumi://`, que lleva el token en su propio estado.
  const token = useServer((s) => s.token) ?? undefined;

  useEffect(() => {
    let dead = false;
    let ro: ResizeObserver | undefined;
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
        // El estilo lo eligió el administrador de un catálogo cerrado de
        // estilos oficiales de Mapbox/OpenFreeMap, y el daemon ya comprobó su
        // forma en `rewrite()`. El validador de MapLibre es más estricto que
        // el propio Mapbox con campos de sus estilos oficiales (rechazaba
        // `dark-v11` por una propiedad que Mapbox sí reconoce); desactivarlo
        // aquí es no exigirle a un estilo oficial que pase un examen que su
        // propio autor no le puso.
        validateStyle: false,
      });
      // Aparecer con un fundido en vez de un fogonazo de lienzo vacío: el
      // estilo tarda un instante en llegar y ese instante se veía en negro.
      m.once("load", () => {
        clearTimeout(vigia);
        setReady(true);
        // Un lienzo de 0×0 carga «bien»: dispara `load`, no lanza ningún error
        // y no dibuja nada. Es el único caso de mapa negro que no se delata
        // solo, así que se mide y se dice.
        const w = box.current?.clientWidth ?? 0;
        const h = box.current?.clientHeight ?? 0;
        if (w < 2 || h < 2) {
          // Con la medida del lienzo a secas no se sabe QUIÉN se quedó sin
          // alto, y el candidato equivocado cuesta una vuelta entera. Se sube
          // por los antepasados diciendo cuánto mide cada uno: el primero de
          // la lista con alto es el que hay que arreglar.
          const cadena: string[] = [];
          let n: HTMLElement | null = box.current;
          for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
            const cls = (n.className || "").toString().split(/\s+/).slice(0, 3).join(".");
            cadena.push(`${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ""}${cls ? `.${cls}` : ""} ${n.clientWidth}×${n.clientHeight}`);
          }
          setWarn((v) => v ?? `el lienzo del mapa mide ${w}×${h} px y no tiene dónde dibujarse · ${cadena.join(" ← ")}`);
        }
        m.resize();

        // Y el último caso mudo: estilo cargado, lienzo con tamaño, y aun así
        // ni una tesela. MapLibre no avisa de eso — para él el mapa «está» —,
        // así que se le pregunta a los cuatro segundos.
        setTimeout(() => {
          if (dead || m.areTilesLoaded()) return;
          const fuentes = Object.keys(m.getStyle()?.sources ?? {})
            .map((s) => `${s}:${m.isSourceLoaded(s) ? "ok" : "sin teselas"}`)
            .join(", ");
          setWarn((v) => v ?? `el estilo cargó pero no llegó ninguna tesela (${fuentes})`);
        }, 4000);
      });

      // Un mapa que no acaba de cargar Y no se queja es el peor caso posible:
      // un rectángulo negro sin nada que depurar. Si en ocho segundos no ha
      // disparado `load`, se dice — con las capas y fuentes que sí llegaron,
      // que es lo que distingue «el estilo no llegó» de «el estilo está pero
      // sus teselas no».
      const vigia = setTimeout(() => {
        if (dead) return;
        const s = m.getStyle();
        setWarn((v) => v ?? `el estilo se cargó (${
          Object.keys(s?.sources ?? {}).length} fuentes, ${s?.layers?.length ?? 0} capas) pero ` +
          "el mapa no terminó de dibujarse en 8 s");
      }, 8000);

      // MapLibre avisa aquí de un estilo o unas teselas que no cargan. Sin
      // esto el mapa se quedaba en negro sin decir nada, que es justo lo que
      // este subsistema se prohíbe. Sin `message` se enseña el objeto crudo:
      // un error sin texto seguía siendo un rectángulo negro y mudo.
      m.on("error", (e) => {
        const err = (e as { error?: unknown }).error;
        const msg = (err as { message?: string } | undefined)?.message
          ?? (err === undefined ? "MapLibre lanzó un error sin detalle" : String(err));
        // Solo el primero: una tesela rota se repite en cada nivel de zoom y
        // la franja acabaría parpadeando con el mismo texto.
        setWarn((v) => v ?? msg);
        console.error("[mapa]", e);
      });
      // MapLibre mide su contenedor UNA vez, al construirse. Aquí eso no basta:
      // el cajón lateral entra y sale, y la ventana se redimensiona con
      // nuestros propios tiradores — sin esto el lienzo se queda con la medida
      // que tenía en el primer render.
      ro = new ResizeObserver(() => m.resize());
      ro.observe(box.current);
      map.current = m;
    })();
    return () => {
      dead = true;
      ro?.disconnect();
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
      marker.getElement().addEventListener("click", () => {
        // Acercarse al punto que acabas de pulsar, siempre: aunque quien
        // escucha no haga nada con el clic, el mapa tiene que responder.
        m.easeTo({
          center: [mk.lng, mk.lat],
          zoom: Math.max(m.getZoom(), 13),
          duration: 900, easing: (t) => 1 - Math.pow(1 - t, 3),
        });
        onMarker?.(mk.id);
      });
      return marker;
    });
  }, [markers, onMarker]);

  // Volar a un punto concreto. `curve` y `speed` son lo que convierte un salto
  // en un vuelo: la cámara se aleja, cruza y vuelve a bajar, que es como se
  // entiende cuánto te has movido. Con los valores por defecto el mapa
  // «teletransporta» y pierdes el sentido de la distancia.
  useEffect(() => {
    if (flyTo && map.current) {
      map.current.flyTo({
        center: [flyTo.lng, flyTo.lat], zoom: flyTo.zoom,
        duration: 1600, curve: 1.5, speed: 0.9, essential: true,
      });
    }
  }, [flyTo]);

  /** Encuadra todo lo que hay que ver. Un mapa que arranca en el mundo entero
   *  y deja los resultados como dos motas obliga a buscarlos a mano. */
  useEffect(() => {
    const m = map.current;
    if (!m || flyTo || markers.length === 0) return;
    const ir = () => {
      if (markers.length === 1) {
        m.flyTo({ center: [markers[0].lng, markers[0].lat], zoom: 11, duration: 1600, curve: 1.5, essential: true });
        return;
      }
      const b = new maplibregl.LngLatBounds();
      markers.forEach((mk) => b.extend([mk.lng, mk.lat]));
      // Hueco para el carril, el dock y el cajón: encuadrar contra el lienzo
      // entero mete los puntos justo debajo de lo que flota encima.
      m.fitBounds(b, { padding: { top: 60, bottom: 90, left: 80, right: 60 }, maxZoom: 12, duration: 1600 });
    };
    if (m.isStyleLoaded()) ir();
    else m.once("load", ir);
  }, [markers, flyTo]);

  if (reason) {
    // Una franja bajo la barra superior, no un cartel centrado: centrado
    // competía por el mismo hueco que el destino de arrastre y la tarjeta de
    // resultado, que también se centran — las dos cosas a la vez se
    // solapaban en cualquier caso vacío sin proveedor de mapas configurado.
    return (
      <div className="absolute inset-0" style={{ background: "radial-gradient(120% 90% at 50% 35%, #16191d 0%, #0e0f11 70%)" }}>
        {/* `top-0` y no `top-[38px]`: la barra de título ya no está dentro de
            este lienzo, vive fuera y por encima de todo. */}
        <div className="absolute left-11 right-0 top-0 z-10 flex items-start gap-2.5
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
      {/* El fondo va SIEMPRE debajo, no solo mientras carga. El lienzo de
          MapLibre es transparente hasta que dibuja algo, y con un estilo que
          carga a medias se quedaba así: por el hueco se veía el planeta de la
          pantalla de entrada, que no pinta nada aquí. */}
      <div className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(120% 90% at 50% 35%, #16191d 0%, #0e0f11 70%)" }} />
      {/* Dos divs y no uno, y esto es la causa del mapa negro que costó cinco
          vueltas: MapLibre le pone la clase `maplibregl-map` a SU contenedor, y
          su hoja de estilos declara ahí `position: relative`. Es la misma
          especificidad que la `absolute` de Tailwind, así que gana la que el
          empaquetador emita después — y cuando gana MapLibre, el contenedor
          deja de estar anclado a los cuatro bordes y pasa a medir lo que midan
          sus hijos, que son todos absolutos: cero de alto. El lienzo cargaba
          «bien», sin un solo error, y no dibujaba nada.
          Con el ancla fuera y el contenedor a `h-full w-full` dentro, da igual
          quién gane esa carrera: el 100 % del padre es el 100 % del padre. */}
      <div className="absolute inset-0">
        <div ref={box} className="h-full w-full transition-opacity duration-700 ease-expo"
          style={{ opacity: ready ? 1 : 0 }} />
      </div>
      {warn && (
        <div className="absolute left-11 right-0 top-0 z-10 flex items-start gap-2.5 border-b
          border-warning/30 bg-[rgba(24,20,14,.82)] px-4 py-2 backdrop-blur"
          style={{ animation: "jg-fade-rise 260ms cubic-bezier(.16,1,.3,1) both" }}>
          <Icon name="alert" size={12} className="mt-px shrink-0 text-warning-fg" />
          <p className="flex-1 text-[10.5px] leading-relaxed text-muted">
            <span className="text-warning-fg">El mapa carga a medias. </span>{warn}
          </p>
          <button onClick={() => setWarn(null)} className="jg-press shrink-0 text-subtle hover:text-fg">
            <Icon name="x" size={11} />
          </button>
        </div>
      )}
    </>
  );
}
