import { convertFileSrc } from "@tauri-apps/api/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";

import { api, type FichaMapa } from "../lib/api";
import { color, nombre, PALETA } from "../lib/origenes";
import { Icon } from "../ui/Icon";

type Pestana = "mapa" | "imagenes";

/** «Abrir en mapa»: los puntos de todo lo que hay en el índice, y el visor de
 *  las imágenes en sí — es donde se comprueba la calidad del material, no
 *  solo dónde cayó. Un solo `fetch` alimenta las dos subpáginas: cambiar de
 *  pestaña no vuelve a pedir nada. */
export function IndexMapDialog({ indiceId, nombreIndice, onCerrar }: {
  indiceId: number;
  nombreIndice: string;
  onCerrar: () => void;
}) {
  const [fichas, setFichas] = useState<FichaMapa[] | null>(null);
  const [pestana, setPestana] = useState<Pestana>("mapa");

  useEffect(() => { void api.indiceImagenes(indiceId).then(setFichas); }, [indiceId]);

  return (
    // Posicionado y medido en ABSOLUTO contra `Overlay` (que sí tiene tamaño
    // definido: `absolute inset-0`), no en `%`/`vw`/`vh` sueltos: dentro de un
    // `grid place-items-center` la fila es de alto automático, así que un
    // `height: %` ahí no tiene contra qué resolverse. `calc(100% - 64px)`
    // aquí SÍ resuelve, porque el padre inmediato en el árbol de posicionados
    // es `Overlay`, no la celda del grid.
    <div className="absolute left-1/2 top-1/2 flex h-[calc(100%-64px)] max-h-[780px] w-[calc(100%-64px)]
      max-w-[1120px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-card
      border border-white/[.13] bg-[rgba(13,15,17,.94)] shadow-lg shadow-black/40 backdrop-blur-xl">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <span className="text-[13px] text-fg">{nombreIndice}</span>
        <span className="font-mono text-[10px] text-subtle">
          {fichas ? `${fichas.length.toLocaleString("es-ES")} imágenes` : "cargando…"}
        </span>
        <div className="ml-2 flex gap-1">
          {(["mapa", "imagenes"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPestana(p)}
              className={`rounded-lg px-3 py-1.5 text-[11.5px] transition-colors ${
                pestana === p ? "bg-white/[.07] text-fg" : "text-subtle hover:text-fg"
              }`}
            >
              {p === "mapa" ? "Mapa" : "Imágenes"}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <button onClick={onCerrar} className="jg-press rounded-lg border border-border p-1.5 text-subtle hover:text-fg">
          <Icon name="x" size={13} />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {fichas === null ? null : fichas.length === 0 ? (
          <div className="grid h-full place-items-center p-8">
            <p className="max-w-[280px] text-center text-[12px] leading-relaxed text-muted">
              Este índice todavía no tiene imágenes que enseñar aquí.
            </p>
          </div>
        ) : pestana === "mapa" ? (
          <PuntosMapa fichas={fichas} />
        ) : (
          <Galeria fichas={fichas} />
        )}
      </div>
    </div>
  );
}

const EXPR_COLOR_FUENTE = [
  "match",
  ["get", "fuente"],
  ...Object.entries(PALETA).flatMap(([k, v]) => [k, v]),
  "#e8e8e6",
] as unknown as mapboxgl.Expression;

function PuntosMapa({ fichas }: { fichas: FichaMapa[] }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<mapboxgl.Map | null>(null);
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
        center: [fichas[0].lng, fichas[0].lat],
        zoom: 12,
      });
      m.on("load", () => {
        m.addSource("puntos", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: fichas.map((f) => ({
              type: "Feature",
              properties: { fuente: f.fuente, ruta: f.ruta, capturada_en: f.capturada_en ?? "" },
              geometry: { type: "Point", coordinates: [f.lng, f.lat] },
            })),
          },
        });
        m.addLayer({
          id: "puntos-circulo",
          type: "circle",
          source: "puntos",
          paint: {
            "circle-radius": 3.5,
            "circle-color": EXPR_COLOR_FUENTE,
            "circle-opacity": 0.85,
            "circle-stroke-width": 1,
            "circle-stroke-color": "rgba(0,0,0,.45)",
          },
        });

        const lons = fichas.map((f) => f.lng);
        const lats = fichas.map((f) => f.lat);
        m.fitBounds(
          [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
          { padding: 48, duration: 0 },
        );

        m.on("mouseenter", "puntos-circulo", () => { m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", "puntos-circulo", () => { m.getCanvas().style.cursor = ""; });
        m.on("click", "puntos-circulo", (e) => {
          const feat = e.features?.[0] as unknown as {
            properties: { fuente: string; ruta: string; capturada_en: string };
            geometry: { coordinates: [number, number] };
          } | undefined;
          if (!feat) return;
          const p = feat.properties;
          const coords = feat.geometry.coordinates;
          new mapboxgl.Popup({ closeButton: true, maxWidth: "220px" })
            .setLngLat(coords)
            .setHTML(
              `<div style="font-family:var(--font-sans)">` +
                `<img src="${convertFileSrc(p.ruta)}" style="width:100%;height:120px;object-fit:cover;border-radius:6px" />` +
                `<div style="margin-top:6px;font-size:11px;color:#e8e8e6">${nombre(p.fuente)}</div>` +
                (p.capturada_en
                  ? `<div style="font-size:10px;color:#9a9a95;font-family:var(--font-mono)">${p.capturada_en}</div>`
                  : "") +
              `</div>`,
            )
            .addTo(m);
        });
      });
      mapa.current = m;
    });
    return () => { vivo = false; mapa.current?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (hayClave === false) {
    return (
      <div className="grid h-full place-items-center bg-surface p-8">
        <div className="max-w-[320px] text-center">
          <p className="text-[12px] text-fg">El mapa necesita una clave de Mapbox</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            Se configura en Ajustes, pestaña «Orígenes de red», sección «Mapa base». Mientras
            tanto puedes seguir viendo las imágenes en la pestaña «Imágenes».
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={contenedor} className="h-full w-full" />
      {hayClave && <PuntosLegend fichas={fichas} />}
    </div>
  );
}

/** Un color por procedencia, solo las que de verdad aparecen en este índice:
 *  listar las seis del catálogo cuando aquí solo hay Mapillary sería ruido,
 *  no información. Mismo patrón que `territory/MapLegend`. */
function PuntosLegend({ fichas }: { fichas: FichaMapa[] }) {
  const fuentes = [...new Set(fichas.map((f) => f.fuente))].sort();

  return (
    <div className="absolute bottom-[22px] right-4 z-20 rounded-card border border-white/[.13]
      bg-[rgba(16,19,25,.72)] px-3.5 py-[11px] shadow-lg shadow-black/40 backdrop-blur-xl">
      <p className="text-[8.5px] uppercase tracking-[.13em] text-subtle">Leyenda</p>
      <div className="mt-2.5 flex flex-col gap-1.5">
        {fuentes.map((f) => (
          <div key={f} className="flex items-center gap-2">
            <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: color(f) }} />
            <span className="text-[10.5px] text-muted">{nombre(f)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/// Un índice legacy trae miles de imágenes, y `<img>` × 3000 a la vez es
/// justo lo que tumbaba el scroll: cada una decodifica su fichero completo
/// en memoria aunque esté fuera de pantalla, y `loading="lazy"` por sí solo
/// no evita MONTAR el nodo, solo retrasa la carga de su `src`. En vez de
/// paginar (que solo evitaba el choque inicial — cada "Cargar más" se
/// quedaba montado para siempre) se virtualiza la rejilla: solo existen en
/// el DOM las filas dentro del viewport (+ margen de overscan), sea cual
/// sea el tamaño del índice.
const COLUMNAS = 6;
const HUECO = 10; // gap-2.5 = 0.625rem = 10px

function Galeria({ fichas }: { fichas: FichaMapa[] }) {
  const [abierta, setAbierta] = useState<number | null>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const [anchoColumna, setAnchoColumna] = useState(0);

  useEffect(() => {
    const el = contenedorRef.current;
    if (!el) return;
    const medir = () => {
      const ancho = el.clientWidth - 32; // p-4 a cada lado = 32px
      setAnchoColumna((ancho - HUECO * (COLUMNAS - 1)) / COLUMNAS);
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const filas = Math.ceil(fichas.length / COLUMNAS);
  const altoFila = anchoColumna > 0 ? anchoColumna * 0.75 : 0; // aspect-[4/3]

  const virtualizador = useVirtualizer({
    count: filas,
    getScrollElement: () => contenedorRef.current,
    estimateSize: () => altoFila + HUECO,
    overscan: 4,
  });

  return (
    <div ref={contenedorRef} className="h-full overflow-y-auto p-4">
      {anchoColumna > 0 && (
        <div style={{ position: "relative", height: virtualizador.getTotalSize(), width: "100%" }}>
          {virtualizador.getVirtualItems().map((fila) => {
            const inicio = fila.index * COLUMNAS;
            return (
              <div
                key={fila.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${fila.start}px)`,
                  display: "grid",
                  gridTemplateColumns: `repeat(${COLUMNAS}, 1fr)`,
                  gap: HUECO,
                }}
              >
                {fichas.slice(inicio, inicio + COLUMNAS).map((f, j) => (
                  <button
                    key={f.id}
                    onClick={() => setAbierta(inicio + j)}
                    className="relative aspect-[4/3] overflow-hidden rounded-md border border-border transition-colors
                      hover:border-white/[.24]"
                  >
                    <img src={convertFileSrc(f.ruta)} alt="" loading="lazy" className="h-full w-full object-cover" />
                    <span className="absolute bottom-1 left-1 rounded-[3px] bg-black/50 px-1 py-px font-mono text-[8px] text-white/75">
                      {nombre(f.fuente)}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {abierta !== null && (
        <Lightbox fichas={fichas} indice={abierta} onCerrar={() => setAbierta(null)} onNavegar={setAbierta} />
      )}
    </div>
  );
}

function Lightbox({ fichas, indice, onCerrar, onNavegar }: {
  fichas: FichaMapa[];
  indice: number;
  onCerrar: () => void;
  onNavegar: (i: number) => void;
}) {
  const f = fichas[indice];

  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar();
      else if (e.key === "ArrowRight" && indice < fichas.length - 1) onNavegar(indice + 1);
      else if (e.key === "ArrowLeft" && indice > 0) onNavegar(indice - 1);
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [indice, fichas.length, onCerrar, onNavegar]);

  return (
    <div className="absolute inset-0 z-10 flex bg-[rgba(5,7,10,.92)] backdrop-blur-sm">
      <div className="relative flex flex-1 items-center justify-center p-6">
        <img src={convertFileSrc(f.ruta)} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        {indice > 0 && (
          <button
            onClick={() => onNavegar(indice - 1)}
            className="jg-press absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-fg"
          >
            <Icon name="back" size={16} />
          </button>
        )}
        {indice < fichas.length - 1 && (
          <button
            onClick={() => onNavegar(indice + 1)}
            className="jg-press absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-fg"
          >
            <Icon name="chevron" size={16} className="-rotate-90" />
          </button>
        )}
      </div>
      <aside className="w-[260px] shrink-0 overflow-y-auto border-l border-border bg-[rgba(16,18,21,.92)] p-4">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10.5px] text-subtle">{indice + 1} / {fichas.length}</p>
          <button onClick={onCerrar} className="text-subtle hover:text-fg">
            <Icon name="x" size={13} />
          </button>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <Campo etiqueta="Procedencia" valor={nombre(f.fuente)} />
          {f.capturada_en && <Campo etiqueta="Capturada" valor={f.capturada_en} mono />}
          {f.ancho && f.alto && <Campo etiqueta="Tamaño" valor={`${f.ancho} × ${f.alto}`} mono />}
          <Campo etiqueta="Coordenadas" valor={`${f.lat.toFixed(6)}, ${f.lng.toFixed(6)}`} mono />
          {f.rumbo !== null && <Campo etiqueta="Rumbo" valor={`${Math.round(f.rumbo)}°`} mono />}
          {f.licencia && <Campo etiqueta="Licencia" valor={f.licencia} />}
        </div>
      </aside>
    </div>
  );
}

function Campo({ etiqueta, valor, mono }: { etiqueta: string; valor: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[8.5px] uppercase tracking-[.11em] text-subtle">{etiqueta}</p>
      <p className={`mt-0.5 text-fg ${mono ? "font-mono text-[10.5px]" : "text-[11.5px]"}`}>{valor}</p>
    </div>
  );
}
