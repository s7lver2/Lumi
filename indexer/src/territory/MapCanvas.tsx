import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";

import { api, type Clasificacion, type Punto, type SondeoTesela } from "../lib/api";
import { color } from "../lib/origenes";
import { teselaAPoligono, type Poligono } from "../lib/quadkey";
import { Icon } from "../ui/Icon";

/** Ease-out cúbico, la misma curva que MapCanvas del subsistema 6, para que
 *  los vuelos se sientan igual en las dos aplicaciones. Nunca `essential`:
 *  eso pisa el «reducir movimiento» del sistema operativo. */
const EASE_OUT_CUBIC = (t: number) => 1 - Math.pow(1 - t, 3);

const RADIO_TIERRA_M = 6_371_000;

function poligonoGeoJSON(puntos: Punto[]): Poligono {
  const anillo = puntos.map((p) => [p.lng, p.lat]);
  if (anillo.length > 0) anillo.push(anillo[0]);
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [anillo] },
  };
}

/** Haversine, metros. Solo hace falta para el radio en vivo del círculo: no
 *  merece traer una dependencia por una fórmula de cuatro líneas. */
function metrosEntre(a: Punto, b: Punto): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.sqrt(s));
}

/** Un polígono de `lados` vértices aproximando el círculo de `radioM` metros
 *  centrado en `centro`. 48 lados es indistinguible de un círculo a la escala
 *  en que se dibuja territorio (varios km²) y barato de reclasificar. */
function circuloAPuntos(centro: Punto, radioM: number, lados = 48): Punto[] {
  const lat0 = (centro.lat * Math.PI) / 180;
  const pts: Punto[] = [];
  for (let i = 0; i < lados; i++) {
    const ang = (2 * Math.PI * i) / lados;
    const dLat = (radioM * Math.cos(ang)) / RADIO_TIERRA_M;
    const dLng = (radioM * Math.sin(ang)) / (RADIO_TIERRA_M * Math.cos(lat0));
    pts.push({ lat: centro.lat + (dLat * 180) / Math.PI, lng: centro.lng + (dLng * 180) / Math.PI });
  }
  return pts;
}

/** Las cuatro esquinas del rectángulo alineado a lat/lng entre dos puntos
 *  opuestos. No es el rectángulo "en pantalla" (eso giraría con el mapa); es
 *  el rectángulo en el terreno, que es lo que el 7a clasifica. */
function rectanguloAPuntos(a: Punto, b: Punto): Punto[] {
  return [
    { lat: a.lat, lng: a.lng },
    { lat: a.lat, lng: b.lng },
    { lat: b.lat, lng: b.lng },
    { lat: b.lat, lng: a.lng },
  ];
}

type Herramienta = "mano" | "poligono" | "rectangulo" | "circulo";

const HERRAMIENTAS: { id: Herramienta; icon: "mano" | "poligono" | "rectangulo" | "circulo"; titulo: string }[] = [
  { id: "mano", icon: "mano", titulo: "Mover el mapa — arrastra para desplazarte, sin dibujar nada" },
  { id: "poligono", icon: "poligono", titulo: "Polígono a mano — clic por esquina, doble clic para cerrar" },
  { id: "rectangulo", icon: "rectangulo", titulo: "Rectángulo — arrastra de una esquina a la opuesta" },
  { id: "circulo", icon: "circulo", titulo: "Círculo — arrastra del centro hacia fuera" },
];

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
  // "mano" por defecto: mover el mapa para mirar alrededor no debería
  // dibujar nada. Antes el polígono era la herramienta por defecto y un clic
  // cualquiera —para fijarse en un sitio— añadía una esquina sin querer.
  const [herramienta, setHerramienta] = useState<Herramienta>("mano");
  const herramientaRef = useRef<Herramienta>("mano");
  // El mapa se monta una sola vez (efecto con `[]`); sin refs, sus manejadores
  // de evento se quedarían con la `herramienta` y el `onPoligonoListo` del
  // primer render para siempre — el mismo bug de cierre que dejaba los puntos
  // de Mapillary sin pintar (ver más abajo).
  const onPoligonoListoRef = useRef(onPoligonoListo);
  // `null` mientras se pregunta, `false` cuando se sabe que no hay clave. Sin
  // este estado el mapa se quedaba en un `<div>` vacío para siempre y nadie
  // decía por qué: exactamente el fallo silencioso que PRODUCT.md prohíbe.
  const [hayClave, setHayClave] = useState<boolean | null>(null);
  // La misma clave del mapa sirve para el geocodificador de la búsqueda: es
  // el mismo producto de Mapbox, no una cuenta aparte.
  const claveMapaRef = useRef<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [sugerencias, setSugerencias] = useState<{ nombre: string; lng: number; lat: number }[]>([]);
  const [buscando, setBuscando] = useState(false);
  const sondeoBusqueda = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { herramientaRef.current = herramienta; }, [herramienta]);
  useEffect(() => { onPoligonoListoRef.current = onPoligonoListo; }, [onPoligonoListo]);

  useEffect(() => {
    let vivo = true;
    void api.mapboxClave().then((clave) => {
      if (!vivo) return;
      setHayClave(!!clave);
      claveMapaRef.current = clave;
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

        const pintarDibujo = (pts: Punto[]) => {
          (m.getSource("dibujo") as mapboxgl.GeoJSONSource)?.setData({
            type: "FeatureCollection",
            features: pts.length >= 3 ? [poligonoGeoJSON(pts)] : [],
          });
        };

        // --- Polígono a mano: clic añade esquina, doble clic cierra. -------
        m.on("click", (e) => {
          if (herramientaRef.current !== "poligono") return;
          puntos.current = [...puntos.current, { lat: e.lngLat.lat, lng: e.lngLat.lng }];
          pintarDibujo(puntos.current);
        });
        m.on("dblclick", (e) => {
          if (herramientaRef.current !== "poligono") return;
          e.preventDefault();
          if (puntos.current.length >= 3) onPoligonoListoRef.current(puntos.current);
        });

        // --- Rectángulo y círculo: arrastrar de un punto a otro. -----------
        // Los dos comparten el gesto (down → move → up); solo cambia qué
        // forma sale del par de puntos. Se apaga `dragPan` mientras se
        // arrastra o mover el ratón para definir la forma también movería
        // el mapa debajo. Con "mano" o "polígono" activos este bloque entero
        // no hace nada: son las únicas dos herramientas que NO capturan el
        // arrastre, así que arrastrar con ellas siempre mueve el mapa, nunca
        // dibuja por accidente.
        const esFormaDeArrastre = () =>
          herramientaRef.current === "rectangulo" || herramientaRef.current === "circulo";
        let origen: Punto | null = null;
        m.on("mousedown", (e) => {
          if (!esFormaDeArrastre()) return;
          origen = { lat: e.lngLat.lat, lng: e.lngLat.lng };
          m.dragPan.disable();
        });
        m.on("mousemove", (e) => {
          if (!origen || !esFormaDeArrastre()) return;
          const actual = { lat: e.lngLat.lat, lng: e.lngLat.lng };
          const pts = herramientaRef.current === "rectangulo"
            ? rectanguloAPuntos(origen, actual)
            : circuloAPuntos(origen, metrosEntre(origen, actual));
          pintarDibujo(pts);
        });
        m.on("mouseup", (e) => {
          if (!origen || !esFormaDeArrastre()) return;
          m.dragPan.enable();
          const actual = { lat: e.lngLat.lat, lng: e.lngLat.lng };
          const pts = herramientaRef.current === "rectangulo"
            ? rectanguloAPuntos(origen, actual)
            : circuloAPuntos(origen, metrosEntre(origen, actual));
          origen = null;
          // Un arrastre de un solo punto (clic sin mover) no es una forma:
          // clasificarlo tiraría de cientos de teselas alrededor del punto
          // sin que el operador haya decidido nada.
          if (metrosEntre(pts[0], pts[Math.floor(pts.length / 2)]) < 5) {
            pintarDibujo([]);
            return;
          }
          onPoligonoListoRef.current(pts);
        });
      });
      mapa.current = m;
    });
    return () => { vivo = false; mapa.current?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Añade la capa de puntos de Mapillary en cuanto hay clave, sin importar si
  // llegó antes o después de que el mapa cargase. Antes esto vivía dentro del
  // efecto de montaje (arriba) y leía `tokenMapillary` de un cierre que se
  // creaba una sola vez al montar: si la clave llegaba después de `load`
  // (lo normal, porque `claveLeer` es una llamada async aparte), la capa
  // nunca se añadía y no había manera de que apareciera un punto verde.
  useEffect(() => {
    const m = mapa.current;
    if (!m || !tokenMapillary) return;
    const anadir = () => {
      if (m.getSource("mly")) return;
      // Por sus teselas vectoriales oficiales: una petición por tesela de
      // pantalla, gratis, y ya vienen cacheadas. No pasa por el backend, así
      // que Rust no tiene que decodificar nada.
      //
      // La URL vive aquí y solo aquí: estas teselas las pide el navegador
      // directamente a Mapillary, nunca el backend, así que una constante en
      // Rust solo sería una segunda copia que se desincroniza.
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
        layout: { visibility: activos?.has("mapillary") ? "visible" : "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 16, 2.6],
          "circle-color": "#4ec9a5",
          "circle-opacity": 0.9,
        },
      });
    };
    if (m.isStyleLoaded()) anadir(); else m.once("load", anadir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenMapillary]);

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

  function borrarTrazo() {
    puntos.current = [];
    (mapa.current?.getSource("dibujo") as mapboxgl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection", features: [],
    });
  }

  function elegirHerramienta(h: Herramienta) {
    // Cambiar ENTRE herramientas de dibujo a mitad de un trazo lo descarta: no
    // hay una forma sensata de seguir un polígono a mano con un rectángulo.
    // Pasar a "mano" no borra nada — es la herramienta para solo mirar
    // alrededor, y perder un trazo a medio hacer por eso sería un castigo.
    if (h !== "mano") borrarTrazo();
    setHerramienta(h);
  }

  // Geocodificador de Mapbox, con la misma clave que el mapa: es el mismo
  // producto, no una cuenta aparte. Con debounce porque cada tecla no merece
  // su propia petición de red.
  function alEscribirBusqueda(q: string) {
    setBusqueda(q);
    if (sondeoBusqueda.current) clearTimeout(sondeoBusqueda.current);
    if (q.trim().length < 3 || !claveMapaRef.current) {
      setSugerencias([]);
      return;
    }
    sondeoBusqueda.current = setTimeout(async () => {
      setBuscando(true);
      try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
          `?access_token=${claveMapaRef.current}&limit=5&language=es`;
        const r = await fetch(url);
        const j: { features?: { place_name: string; center: [number, number] }[] } = await r.json();
        setSugerencias(
          (j.features ?? []).map((f) => ({ nombre: f.place_name, lng: f.center[0], lat: f.center[1] })),
        );
      } catch {
        setSugerencias([]);
      } finally {
        setBuscando(false);
      }
    }, 350);
  }

  function irA(s: { nombre: string; lng: number; lat: number }) {
    setBusqueda(s.nombre);
    setSugerencias([]);
    const m = mapa.current;
    if (!m) return;

    // `flyTo`, no el `easeTo` de `volarA`: un resultado de búsqueda puede
    // estar a medio planeta, y subir de altitud antes de bajar se siente
    // mucho mejor que un paneo plano. `volarA` sigue siendo el vuelo normal
    // para todo lo que ya está cerca (centrar un índice, por ejemplo).
    m.flyTo({ center: [s.lng, s.lat], zoom: 13, duration: 1700, curve: 1.4, easing: EASE_OUT_CUBIC });

    // Un pulso puntual en el destino: dice "aquí" en el momento en que el
    // vuelo llega, sin quedarse parpadeando para siempre.
    const el = document.createElement("div");
    el.className = "lumi-anim";
    el.style.width = "14px";
    el.style.height = "14px";
    el.style.borderRadius = "999px";
    el.style.background = "#85b7eb";
    el.style.animation = "jg-destino-pulso 1.7s ease-out 1";
    const marca = new mapboxgl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(m);
    setTimeout(() => marca.remove(), 1800);
  }

  // El motivo real, no un mapa en blanco: sin clave no hay teselas que pedir,
  // y quien lo lee tiene que saber exactamente dónde se arregla.
  if (hayClave === false) {
    return (
      <div className="grid h-full w-full place-items-center bg-surface">
        <div className="max-w-[340px] text-center">
          <p className="text-[12px] text-fg">El mapa necesita una clave de Mapbox</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            Sin ella no se pueden pedir las teselas del mapa base, así que no hay dónde dibujar
            el territorio. Se configura en Ajustes, pestaña «Orígenes de red», sección «Mapa base».
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={contenedor} className="h-full w-full" />

      {/* z-30, por encima de los paneles informativos (z-20, AvailabilityPanel
          etc.): son controles, no información, y la lista de sugerencias no
          puede quedar tapada por un panel que se abre en el mismo sitio. */}
      {hayClave && (
        <div className="absolute left-3 top-3 z-30 w-[300px]">
          <div className="flex items-center gap-2 rounded-lg border border-white/[.13] bg-[rgba(16,19,25,.82)]
            px-3 py-2 shadow-lg shadow-black/40 backdrop-blur-xl">
            <Icon name="search" size={13} className="shrink-0 text-subtle" />
            <input
              value={busqueda}
              onChange={(e) => alEscribirBusqueda(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && sugerencias[0]) irA(sugerencias[0]); }}
              placeholder="Buscar un lugar…"
              className="w-full bg-transparent text-[12px] text-fg outline-none placeholder:text-subtle"
            />
            {buscando && <Icon name="spinner" size={12} className="shrink-0 text-subtle" />}
          </div>
          {sugerencias.length > 0 && (
            <div className="lumi-anim mt-1.5 overflow-hidden rounded-lg border border-white/[.13]
              bg-[rgba(16,19,25,.94)] shadow-lg shadow-black/40 backdrop-blur-xl"
              style={{ animation: "jg-fade-rise 160ms cubic-bezier(.2,.85,.35,1) both" }}>
              {sugerencias.map((s, i) => (
                <button
                  key={s.nombre}
                  onClick={() => irA(s)}
                  className="lumi-anim block w-full truncate px-3 py-2 text-left text-[11.5px] text-fg
                    transition-colors duration-150 hover:bg-white/[.06]"
                  style={{ animation: `jg-fade-rise 160ms ${i * 25}ms cubic-bezier(.2,.85,.35,1) both` }}
                >
                  {s.nombre}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Siempre visible, con o sin área ya clasificada: es la única manera
          de volver a "mano" para simplemente mirar el mapa, y de arrancar un
          área nueva sin depender de otro botón en otro panel. */}
      {hayClave && (
        <div className="absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 gap-[3px] rounded-lg
          border border-white/[.13] bg-[rgba(16,19,25,.72)] p-[5px] shadow-lg shadow-black/40 backdrop-blur-xl">
          {HERRAMIENTAS.map((h) => (
            <button
              key={h.id}
              title={h.titulo}
              onClick={() => elegirHerramienta(h.id)}
              className={`grid h-7 w-7 place-items-center rounded-[7px] ${
                herramienta === h.id ? "bg-white/[.09] text-fg" : "text-subtle hover:text-fg"}`}
            >
              <Icon name={h.icon} size={14} />
            </button>
          ))}
          <span className="mx-0.5 w-px bg-white/10" />
          <button
            title="Borrar el trazo actual"
            onClick={borrarTrazo}
            className="grid h-7 w-7 place-items-center rounded-[7px] text-subtle hover:text-fg"
          >
            <Icon name="trash" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

/** Vuelo con la misma curva que el cliente, para que el gesto se sienta igual
 *  en las dos aplicaciones. Se expone aparte porque no todo vuelo nace de un
 *  clic del operador (p. ej. centrar tras cargar un índice). */
export function volarA(m: mapboxgl.Map, centro: [number, number], zoom: number) {
  m.easeTo({ center: centro, zoom, duration: 900, easing: EASE_OUT_CUBIC });
}
