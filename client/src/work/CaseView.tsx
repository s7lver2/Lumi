import { useEffect, useMemo, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api, type Analysis, type Case, type Image, type Project } from "../lib/api";
import { lumiUrl, pickAndUpload, uploadPaths } from "../lib/bridge";
import { useServer } from "../lib/store";
import { Filmstrip } from "./Filmstrip";
import { MapCanvas, type Marker } from "./MapCanvas";
import { ResultCard } from "./ResultCard";
import { SummaryBar } from "./SummaryBar";

export function CaseView({
  project, case_, rail, onBack,
}: { project: Project; case_: Case; rail: React.ReactNode; onBack: () => void }) {
  const token = useServer((s) => s.token) ?? undefined;
  const [images, setImages] = useState<Image[]>([]);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [im, an] = await Promise.all([
        api.get<Image[]>(`/v1/cases/${case_.id}/images`, token),
        api.get<Analysis[]>(`/v1/cases/${case_.id}/analyses`, token),
      ]);
      setImages(im);
      setAnalyses(an);
      setSel((s) => s ?? im[0]?.id ?? null);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => { void load(); }, [case_.id]);

  async function add(paths?: string[]) {
    setBusy(true);
    setError(null);
    try {
      const nuevas = paths ? await uploadPaths(case_.id, paths) : await pickAndUpload(case_.id);
      if (nuevas.length) {
        setImages((v) => [...v, ...nuevas]);
        setSel((s) => s ?? nuevas[0].id);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // Soltar imágenes sobre el mapa, como en la v1. Tauri entrega rutas, no
  // bytes, así que va por el mismo camino que el selector de archivos.
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop") void add(e.payload.paths);
    });
    return () => { void un.then((f) => f()); };
  }, [case_.id]);

  const image = images.find((i) => i.id === sel) ?? null;
  const mine = useMemo(
    () => (sel === null ? [] : analyses.filter((a) => a.image_ids.includes(sel))),
    [analyses, sel],
  );
  const top = mine.find((a) => a.state === "hecho") ?? mine[0] ?? null;

  const markers: Marker[] = useMemo(() => {
    const out: Marker[] = [];
    mine.forEach((a, i) => {
      if (a.result_lat != null && a.result_lng != null) {
        out.push({
          id: `a${a.id}`, lat: a.result_lat, lng: a.result_lng, label: String(i + 1),
          kind: i === 0 ? "top" : "alt", radiusM: a.result_radius_m ?? undefined,
        });
      }
    });
    // El GPS declarado, aparte y en ámbar. Nunca mezclado con lo inferido.
    if (image?.exif_lat != null && image.exif_lng != null) {
      out.push({ id: "exif", lat: image.exif_lat, lng: image.exif_lng, label: "E", kind: "exif" });
    }
    return out;
  }, [mine, image]);

  const flyTo = useMemo(
    () =>
      top?.result_lat != null && top.result_lng != null
        ? { lat: top.result_lat, lng: top.result_lng, zoom: 13 }
        : image?.exif_lat != null && image.exif_lng != null
          ? { lat: image.exif_lat, lng: image.exif_lng, zoom: 13 }
          : null,
    [top, image],
  );

  async function analyze() {
    if (sel === null) return;
    setBusy(true);
    setError(null);
    try {
      const a = await api.post<Analysis>(
        `/v1/cases/${case_.id}/analyses`, { image_ids: [sel], model: "mini" }, token,
      );
      setAnalyses((v) => [a, ...v]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative h-full w-full">
      <MapCanvas markers={markers} flyTo={flyTo} />
      {rail}

      <div className="absolute left-[50px] top-[34px] z-30 flex items-center gap-1.5 text-[11px]">
        <button onClick={onBack} className="text-subtle hover:text-fg">{project.name}</button>
        <span className="text-[#3a3e44]">/</span>
        <span className="text-fg">{case_.name}</span>
      </div>

      <ResultCard analysis={top} image={image} />
      <Filmstrip images={images} selected={sel} onSelect={setSel} onAdd={() => void add()} />

      <aside className="absolute inset-y-0 right-0 z-20 w-[196px] overflow-y-auto border-l border-white/[.06] bg-[rgba(16,18,21,.9)] p-2.5 backdrop-blur-xl">
        {image && (
          <div className="mb-2.5 flex items-center gap-2">
            <img src={lumiUrl(`/v1/images/${image.id}/thumb`)} alt=""
              className="h-[30px] w-[38px] shrink-0 rounded object-cover" />
            <span className="truncate font-mono text-[10px] text-muted">{image.filename}</span>
          </div>
        )}
        <p className="mb-2 text-[8px] uppercase tracking-[.11em] text-subtle">
          Caso · {images.length} imágenes, {analyses.length} análisis
        </p>

        {mine.map((a, i) => (
          <div key={a.id} className="mb-1.5 rounded-lg border border-white/[.07] p-2">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[9px] text-subtle">{i + 1}</span>
              <span className="flex-1 truncate text-[11.5px] text-fg">{a.model}</span>
              <span className="rounded border border-border px-1 text-[8.5px] text-subtle">
                {a.state === "hecho" ? "sin verificar" : a.state}
              </span>
            </div>
            {a.state === "hecho" ? (
              <p className="mt-1 font-mono text-[10px] text-muted">
                {a.result_lat!.toFixed(6)}, {a.result_lng!.toFixed(6)}
              </p>
            ) : (
              <p className="mt-1 font-mono text-[10px] text-subtle">
                {a.state === "error" ? a.error : "esperando al motor de inferencia"}
              </p>
            )}
          </div>
        ))}

        {/* El EXIF declarado tiene tarjeta propia y borde ámbar: no es una
            candidata, es lo que la cámara dice. */}
        {image?.exif_lat != null && image.exif_lng != null && (
          <div className="mb-1.5 rounded-lg border border-warning/30 p-2">
            <p className="text-[11.5px] text-warning-fg">EXIF declarado</p>
            <p className="mt-1 font-mono text-[10px] text-muted">
              {image.exif_lat.toFixed(6)}, {image.exif_lng.toFixed(6)}
            </p>
          </div>
        )}

        {/* Los widgets auxiliares de la v1 siguen ahí, bloqueados y diciendo
            el motivo real en vez de un candado: una función no disponible se
            muestra deshabilitada, nunca se oculta. */}
        {["Hora estimada", "Clima", "Objetos detectados"].map((t) => (
          <div key={t} className="mb-1.5 rounded-lg border border-white/[.07] p-2 opacity-60">
            <p className="text-[11.5px] text-subtle">{t}</p>
            <p className="mt-1 font-mono text-[10px] text-subtle">modelo no instalado</p>
          </div>
        ))}

        <button onClick={analyze} disabled={sel === null || busy}
          className="mt-2 w-full rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px disabled:opacity-40">
          {busy ? "Un momento" : "Analizar esta imagen"}
        </button>
        {error && <p className="mt-2 text-[10.5px] leading-snug text-danger-fg">{error}</p>}
      </aside>

      <SummaryBar analysis={top} />
    </div>
  );
}
