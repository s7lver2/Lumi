"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Map as MapboxMap, Popup as MapboxPopup, Expression, MapLayerMouseEvent } from "mapbox-gl";
import { tileBounds } from "../../lib/tiles";
import type { TeselaCatalogo } from "../../lib/catalogo";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// Mismo panel de cristal que flota sobre el lienzo real del Indexer
// (MapCanvas.tsx: buscador, herramientas, leyenda) — border blanco al 13%,
// fondo casi negro translúcido, blur fuerte. No es un panel nuevo.
const GLASS = "rounded-lg border border-white/[.13] bg-[rgba(16,19,25,.82)] shadow-lg shadow-black/40 backdrop-blur-xl";

type Props = { teselas: TeselaCatalogo[]; paquetes: number; autores: number };

function poligonoDeQuadkey(qk: string): [number, number][] {
  const z = qk.length;
  let x = 0, y = 0;
  for (let i = z; i > 0; i--) {
    const mask = 1 << (i - 1);
    switch (qk[z - i]) {
      case "1": x |= mask; break;
      case "2": y |= mask; break;
      case "3": x |= mask; y |= mask; break;
      default: break;
    }
  }
  const b = tileBounds(x, y, z);
  return [
    [b.lonOeste, b.latNorte], [b.lonEste, b.latNorte],
    [b.lonEste, b.latSur], [b.lonOeste, b.latSur], [b.lonOeste, b.latNorte],
  ];
}

function IconoBuscar() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-subtle">
      <circle cx={11} cy={11} r={7} /><path d="M21 21l-4.35-4.35" />
    </svg>
  );
}
function IconoSpinner() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="shrink-0 text-subtle" style={{ animation: "lumi-spin 1.1s linear infinite" }}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    </svg>
  );
}
function IconoX() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
  );
}
function IconoExpandir({ activo }: { activo: boolean }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {activo
        ? <path d="M9 4v4a1 1 0 0 1-1 1H4M20 9h-4a1 1 0 0 1-1-1V4M15 20v-4a1 1 0 0 1 1-1h4M4 15h4a1 1 0 0 1 1 1v4" />
        : <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />}
    </svg>
  );
}

/** Mapa base real de Mapbox (proyección mercator, no el globo 3D por
 *  defecto de mapbox-gl v3 — se nota en cuanto se compara con el resto del
 *  sitio) con un polígono real por tesela reclamada encima. Los controles
 *  no son los de Mapbox de serie (blancos, no pegan con nada): son los
 *  mismos paneles de cristal flotando sobre el mapa que ya usa el Indexer
 *  real en `MapCanvas.tsx` — buscador arriba a la izquierda, herramientas
 *  arriba a la derecha, leyenda abajo a la izquierda. El buscador prueba
 *  primero si el texto coincide con un autor del catálogo (resalta y centra
 *  sus teselas); si no, geocodifica un lugar con la misma API de Mapbox. */
export function MapaInteractivo({ teselas, paquetes, autores }: Props) {
  const contenedorRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<MapboxMap | null>(null);
  const popupRef = useRef<MapboxPopup | null>(null);
  const [listo, setListo] = useState(false);
  const [expandido, setExpandido] = useState(false);
  // Separado de `expandido`: éste decide si el panel está montado (y por
  // tanto si el mapa existe), `entrando` decide si ya se ve en su sitio o
  // todavía en el fotograma de entrada — es lo que permite animar tanto la
  // apertura como el cierre antes de desmontar de verdad.
  const [entrando, setEntrando] = useState(false);
  const [consulta, setConsulta] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [avisoBusqueda, setAvisoBusqueda] = useState<string | null>(null);
  const [autorActivo, setAutorActivo] = useState<string | null>(null);

  useEffect(() => {
    if (!TOKEN || !contenedorRef.current) return;
    let vivo = true;
    let mapa: MapboxMap | null = null;

    import("mapbox-gl").then((mod) => {
      if (!vivo || !contenedorRef.current) return;
      const mapboxgl = mod.default;
      mapboxgl.accessToken = TOKEN;

      mapa = new mapboxgl.Map({
        container: contenedorRef.current,
        style: "mapbox://styles/mapbox/dark-v11",
        projection: "mercator",
        center: [10, 30],
        zoom: 1.6,
        attributionControl: false,
      });
      mapaRef.current = mapa;
      mapa.addControl(new mapboxgl.AttributionControl({ compact: true }));

      mapa.on("load", () => {
        if (!vivo || !mapa) return;

        const featuresPoligonos = teselas.map((t) => ({
          type: "Feature" as const,
          properties: { quadkey: t.quadkey, autor: t.autor, paquete: t.paquete },
          geometry: { type: "Polygon" as const, coordinates: [poligonoDeQuadkey(t.quadkey)] },
        }));
        const featuresPuntos = teselas.map((t) => {
          const anillo = poligonoDeQuadkey(t.quadkey);
          const cx = (anillo[0][0] + anillo[2][0]) / 2;
          const cy = (anillo[0][1] + anillo[2][1]) / 2;
          return {
            type: "Feature" as const,
            properties: { quadkey: t.quadkey, autor: t.autor, paquete: t.paquete },
            geometry: { type: "Point" as const, coordinates: [cx, cy] },
          };
        });

        mapa.addSource("teselas-poligonos", { type: "geojson", data: { type: "FeatureCollection", features: featuresPoligonos } });
        mapa.addSource("teselas-puntos", { type: "geojson", data: { type: "FeatureCollection", features: featuresPuntos } });

        // Puntos: visibles de lejos, se apagan al acercarse — el mapa base
        // ya resuelve el "de lejos es un punto, de cerca es un área real"
        // con su propio zoom continuo, esto solo acompaña la transición.
        mapa.addLayer({
          id: "puntos", type: "circle", source: "teselas-puntos",
          paint: {
            "circle-radius": 3,
            "circle-color": "#e8e8e6",
            "circle-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.9, 12, 0],
          },
        });
        mapa.addLayer({
          id: "poligonos-relleno", type: "fill", source: "teselas-poligonos",
          paint: {
            "fill-color": "#378add",
            "fill-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0, 12, 0.32],
          },
        });
        mapa.addLayer({
          id: "poligonos-borde", type: "line", source: "teselas-poligonos",
          paint: {
            "line-color": "#85b7eb",
            "line-width": 1,
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0, 12, 0.8],
          },
        });

        const mostrarPopup = (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          popupRef.current?.remove();
          const p = f.properties as { quadkey: string; autor: string; paquete: string };
          popupRef.current = new mapboxgl.Popup({ closeButton: false, offset: 8 })
            .setLngLat(e.lngLat)
            .setHTML(
              `<div style="font:11px ui-monospace,monospace;">
                 <div>${p.quadkey}</div>
                 <div style="color:#9a9a95;margin-top:2px;">${p.paquete} · ${p.autor}</div>
               </div>`,
            )
            .addTo(mapa!);
        };
        mapa.on("mouseenter", "poligonos-relleno", () => { mapa!.getCanvas().style.cursor = "pointer"; });
        mapa.on("mouseleave", "poligonos-relleno", () => { mapa!.getCanvas().style.cursor = ""; });
        mapa.on("click", "poligonos-relleno", mostrarPopup);
        mapa.on("click", "puntos", mostrarPopup);

        setListo(true);
      });
    });

    return () => {
      vivo = false;
      popupRef.current?.remove();
      mapa?.remove();
      mapaRef.current = null;
      setListo(false);
    };
    // `expandido` sí es dependencia real: al entrar/salir de pantalla
    // completa el contenedor se porta a document.body (ver el `return` de
    // más abajo), así que es un nodo del DOM distinto y el mapa anterior ya
    // no tiene lienzo — sin recrearlo aquí, expandir dejaba un mapa
    // "zombi" sin canvas en ningún sitio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandido]);

  // Resaltado por autor: dim todo lo que no sea suyo en vez de ocultarlo —
  // así se ve dónde está su territorio respecto al resto, no un mapa vacío.
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa || !listo) return;
    const opacidadRelleno: Expression = autorActivo
      ? ["interpolate", ["linear"], ["zoom"], 9, 0, 12, ["case", ["==", ["get", "autor"], autorActivo], 0.55, 0.08]]
      : ["interpolate", ["linear"], ["zoom"], 9, 0, 12, 0.32];
    mapa.setPaintProperty("poligonos-relleno", "fill-opacity", opacidadRelleno);
  }, [autorActivo, listo]);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    const q = consulta.trim();
    if (!q || !mapaRef.current) return;
    setAvisoBusqueda(null);

    const autorEncontrado = teselas.find((t) => t.autor.toLowerCase().includes(q.toLowerCase()))?.autor;
    if (autorEncontrado) {
      setAutorActivo(autorEncontrado);
      const propias = teselas.filter((t) => t.autor === autorEncontrado);
      const lons = propias.flatMap((t) => poligonoDeQuadkey(t.quadkey).map((p) => p[0]));
      const lats = propias.flatMap((t) => poligonoDeQuadkey(t.quadkey).map((p) => p[1]));
      mapaRef.current.fitBounds(
        [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        { padding: 60, maxZoom: 14, duration: 900 },
      );
      return;
    }

    if (!TOKEN) {
      setAvisoBusqueda("sin autor coincidente, y falta el token de Mapbox para buscar lugares");
      return;
    }
    setAutorActivo(null);
    setBuscando(true);
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${TOKEN}&limit=1`,
      );
      const datos = await res.json();
      const centro = datos.features?.[0]?.center as [number, number] | undefined;
      if (!centro) {
        setAvisoBusqueda("sin resultados");
        return;
      }
      mapaRef.current.flyTo({ center: centro, zoom: 12, duration: 900 });
    } catch {
      setAvisoBusqueda("no se pudo consultar el buscador de lugares");
    } finally {
      setBuscando(false);
    }
  }

  function zoomEn(delta: number) {
    const mapa = mapaRef.current;
    if (!mapa) return;
    mapa.easeTo({ zoom: mapa.getZoom() + delta, duration: 250 });
  }

  // La entrada arranca en el frame SIGUIENTE al montaje (si `entrando`
  // partiera ya en `true` no habría transición de la que animar: el
  // navegador pintaría directamente el estado final). El cierre es al
  // revés — se anima primero, y solo cuando termina se desmonta de verdad
  // (`setExpandido(false)`), o el panel desaparecería de golpe antes de que
  // la transición llegara a verse.
  useEffect(() => {
    if (!expandido) { setEntrando(false); return; }
    const id = requestAnimationFrame(() => setEntrando(true));
    return () => cancelAnimationFrame(id);
  }, [expandido]);

  function cerrarExpandido() {
    setEntrando(false);
    setTimeout(() => setExpandido(false), 260);
  }

  if (!TOKEN) {
    return (
      <p className="mt-8 font-mono text-[11px] text-warning-fg">
        mapa no disponible — falta NEXT_PUBLIC_MAPBOX_TOKEN
      </p>
    );
  }

  const panel = (
      <div
        className={
          expandido
            ? "fixed inset-4 z-50 overflow-hidden rounded-card border border-border shadow-2xl md:inset-10"
            : "relative mt-8 h-[520px] w-full overflow-hidden rounded-card border border-border"
        }
        style={
          expandido
            ? {
                opacity: entrando ? 1 : 0,
                transform: entrando ? "scale(1)" : "scale(.96)",
                transition: "opacity .28s cubic-bezier(.16,1,.3,1), transform .28s cubic-bezier(.16,1,.3,1)",
              }
            : undefined
        }
      >
        <div ref={contenedorRef} className="h-full w-full" />

        {/* buscador — esquina superior izquierda, igual que MapCanvas.tsx */}
        <div className="absolute left-3 top-3 z-30 w-[280px]">
          <form onSubmit={buscar} className={`flex items-center gap-2 px-3 py-2 ${GLASS}`}>
            <IconoBuscar />
            <input
              value={consulta}
              onChange={(e) => setConsulta(e.target.value)}
              placeholder="Buscar un lugar o un autor…"
              className="w-full bg-transparent text-[12px] text-fg outline-none placeholder:text-subtle"
            />
            {buscando && <IconoSpinner />}
          </form>
          {autorActivo && (
            <button
              type="button"
              onClick={() => { setAutorActivo(null); setConsulta(""); }}
              className={`jg-micro mt-1.5 flex items-center gap-1.5 px-2.5 py-1.5 font-mono text-[11px] text-draw-fg ${GLASS}`}
            >
              {autorActivo} <IconoX />
            </button>
          )}
          {avisoBusqueda && (
            <div className={`mt-1.5 px-3 py-1.5 font-mono text-[11px] text-subtle ${GLASS}`}>{avisoBusqueda}</div>
          )}
        </div>

        {/* expandir — esquina superior derecha */}
        <button
          type="button"
          onClick={() => (expandido ? cerrarExpandido() : setExpandido(true))}
          aria-label={expandido ? "Contraer mapa" : "Expandir mapa"}
          className={`jg-micro absolute right-3 top-3 z-30 grid h-9 w-9 place-items-center text-fg hover:bg-white/[.06] ${GLASS}`}
        >
          <IconoExpandir activo={expandido} />
        </button>

        {/* zoom — esquina inferior derecha, mismo pill que la barra de herramientas real */}
        <div className={`absolute bottom-3 right-3 z-30 flex flex-col gap-[3px] p-[5px] ${GLASS}`}>
          <button type="button" onClick={() => zoomEn(1)} aria-label="Acercar" className="grid h-7 w-7 place-items-center rounded-[7px] text-subtle hover:bg-white/[.09] hover:text-fg">+</button>
          <button type="button" onClick={() => zoomEn(-1)} aria-label="Alejar" className="grid h-7 w-7 place-items-center rounded-[7px] text-subtle hover:bg-white/[.09] hover:text-fg">–</button>
        </div>

        {/* leyenda + cifras — esquina inferior izquierda, mismo panel que MapLegend.tsx */}
        <div className={`absolute bottom-3 left-3 z-20 px-3 py-2.5 ${GLASS}`}>
          <div className="flex gap-4 font-mono text-[10.5px] text-subtle">
            <span><b className="text-fg">{teselas.length}</b> zonas</span>
            <span><b className="text-fg">{paquetes}</b> paquetes</span>
            <span><b className="text-fg">{autores}</b> autores</span>
          </div>
          <p className="mt-1 text-[9.5px] text-subtle">clic en una tesela = quién la reclamó</p>
        </div>
      </div>
  );

  // Expandido se saca por portal a document.body: la sección que lo envuelve
  // (RevelaSeccion) deja una animación de scroll con `transform` aplicada
  // que, aunque termine resuelta en "none", sigue creando un containing
  // block para `position:fixed` en algunos navegadores — el panel expandido
  // quedaba encajonado dentro de la sección en vez de cubrir la pantalla.
  // Fuera del árbol normal, ese problema no existe. El mapa se remonta al
  // entrar/salir de pantalla completa (nuevo contexto WebGL) — coste
  // aceptable por una interacción que no es de cada segundo.
  if (expandido) {
    return createPortal(
      <>
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-md"
          style={{ opacity: entrando ? 1 : 0, transition: "opacity .28s cubic-bezier(.16,1,.3,1)" }}
          onClick={cerrarExpandido}
        />
        {panel}
      </>,
      document.body,
    );
  }
  return panel;
}
