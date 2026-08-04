import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api, type Analysis, type Case, type Image, type Project, type Usage } from "../lib/api";
import { pickPaths, uploadPaths } from "../lib/bridge";
import { useServer } from "../lib/store";
import { useDismissable } from "../lib/useDismissable";
import { DropFrame, DropTarget } from "./DropTarget";
import { Filmstrip } from "./Filmstrip";
import { MapCanvas, type Marker } from "./MapCanvas";
import { ResultCard } from "./ResultCard";
import { ResultsSidebar } from "./ResultsSidebar";
import { SummaryBar } from "./SummaryBar";
import { TopBar } from "./TopBar";
import { UploadPopup } from "./UploadPopup";

const SIDEBAR = 250;
const GB = 1024 * 1024 * 1024;

export function CaseView({
  project, case_, rail, onBack, onProjects,
}: {
  project: Project; case_: Case; rail: React.ReactNode;
  onBack: () => void; onProjects: () => void;
}) {
  const token = useServer((s) => s.token) ?? undefined;
  const isAdmin = useServer((s) => s.isAdmin);
  const rawModels = useServer((s) => s.limits?.models) ?? [];
  // El servidor ya deja pasar cualquier modelo a un administrador
  // (`routes/analyses.rs` salta la comprobación si `is_admin`), igual que
  // salta `can_create_projects`. Sin esto, un administrador cuya cuenta no
  // tuviera ningún modelo en `limits.models` veía el selector vacío y el
  // botón bloqueado por un límite que el propio servidor no le aplica.
  const models = isAdmin && rawModels.length === 0 ? ["mini"] : rawModels;
  const [images, setImages] = useState<Image[] | null>(null);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [selAnalysis, setSelAnalysis] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** Las imágenes que el popup tiene delante. `null` = popup cerrado. */
  const [staged, setStaged] = useState<number[] | null>(null);
  const popup = useDismissable(staged !== null, 180);

  async function load() {
    try {
      const [im, an, u] = await Promise.all([
        api.get<Image[]>(`/v1/cases/${case_.id}/images`, token),
        api.get<Analysis[]>(`/v1/cases/${case_.id}/analyses`, token),
        api.get<Usage>("/v1/me/usage", token),
      ]);
      setImages(im);
      setAnalyses(an);
      setUsage(u);
      setSel((s) => (s !== null && im.some((x) => x.id === s) ? s : im[0]?.id ?? null));
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => { void load(); }, [case_.id]);

  const list = images ?? [];

  /** Sube y deja las nuevas delante del popup, en vez de mandarlas al fondo de
   *  la tira sin decir nada. Si el popup ya estaba abierto, se acumulan. */
  async function add(paths: string[]) {
    if (paths.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const nuevas = await uploadPaths(case_.id, paths);
      if (nuevas.length) {
        setImages((v) => [...(v ?? []), ...nuevas]);
        setSel(nuevas[0].id);
        setStaged((s) => [...(s ?? []), ...nuevas.map((n) => n.id)]);
      }
      // La cuota consumida cambia con cada subida, y el destino de arrastre la
      // enseña: releerla aquí evita que diga una cifra vieja.
      api.get<Usage>("/v1/me/usage", token).then(setUsage).catch(() => {});
    } catch (e) {
      setError(String(e));
      // Con el popup ya abierto el error se lee dentro; si no, hay que abrirlo
      // para que no se pierda en un rincón.
      if (staged === null) setStaged([]);
    } finally {
      setBusy(false);
    }
  }

  async function pick() {
    try {
      await add(await pickPaths());
    } catch (e) {
      setError(String(e));
    }
  }

  /** Copiar imágenes de otro caso del mismo proyecto. Es una copia, no un
   *  traslado: el caso de origen se queda igual. Cada id va en su propia
   *  llamada porque el servidor no tiene un "reuse en lote" — no hace falta
   *  cuando son unas pocas imágenes desde un mosaico. */
  async function reuse(imageIds: number[]) {
    if (imageIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const copiadas: Image[] = [];
      for (const id of imageIds) {
        copiadas.push(await api.post<Image>(`/v1/cases/${case_.id}/images/reuse`, { image_id: id }, token));
      }
      setImages((v) => [...(v ?? []), ...copiadas]);
      setSel(copiadas[0].id);
      setStaged((s) => [...(s ?? []), ...copiadas.map((n) => n.id)]);
      api.get<Usage>("/v1/me/usage", token).then(setUsage).catch(() => {});
    } catch (e) {
      setError(String(e));
      if (staged === null) setStaged([]);
    } finally {
      setBusy(false);
    }
  }

  // Soltar imágenes sobre la ventana, como en la v1. Tauri entrega rutas, no
  // bytes, así que va por el mismo camino que el selector de archivos. Los
  // eventos `enter`/`leave` son lo que da la señal visual: sin ellos, arrastrar
  // sobre un caso con imágenes no parecía que fuera a servir de nada.
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "over" || e.payload.type === "enter") setDragging(true);
      else if (e.payload.type === "leave") setDragging(false);
      else if (e.payload.type === "drop") {
        setDragging(false);
        void add(e.payload.paths);
      }
    });
    return () => { void un.then((f) => f()); };
  }, [case_.id, staged]);

  async function discard(id: number) {
    setBusy(true);
    setError(null);
    try {
      await api.del(`/v1/images/${id}`, token);
      setImages((v) => (v ?? []).filter((im) => im.id !== id));
      setStaged((s) => {
        const next = (s ?? []).filter((x) => x !== id);
        return next.length ? next : null;
      });
      setSel((s) => (s === id ? null : s));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Un análisis por imagen: el motor todavía no sabe cruzar varias, y
   *  prometerlo aquí sería mentir (ver FUTURO.md). */
  async function analyze(model: string, ids: number[]) {
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const nuevos: Analysis[] = [];
      for (const id of ids) {
        nuevos.push(await api.post<Analysis>(
          `/v1/cases/${case_.id}/analyses`, { image_ids: [id], model }, token,
        ));
      }
      setAnalyses((v) => [...nuevos, ...v]);
      setStaged(null);
      setSel(ids[0]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const image = list.find((i) => i.id === sel) ?? null;
  const mine = useMemo(
    () => (sel === null ? [] : analyses.filter((a) => a.image_ids.includes(sel))),
    [analyses, sel],
  );
  // El primero hecho manda; si no hay ninguno, el más reciente, para que la
  // tarjeta pueda decir "en cola" en vez de no decir nada.
  const shown = useMemo(
    () => mine.find((a) => a.id === selAnalysis) ?? mine.find((a) => a.state === "hecho") ?? mine[0] ?? null,
    [mine, selAnalysis],
  );
  // La barra lateral solo existe cuando hay algo que enseñar, como en la v1.
  // Sin resultados ni EXIF, el mapa se queda entero.
  const hasResults = mine.length > 0 || (image?.exif_lat != null && image.exif_lng != null);

  const markers: Marker[] = useMemo(() => {
    const out: Marker[] = [];
    mine.forEach((a, i) => {
      if (a.result_lat != null && a.result_lng != null) {
        out.push({
          id: `a${a.id}`, lat: a.result_lat, lng: a.result_lng, label: String(i + 1),
          kind: a.id === shown?.id ? "top" : "alt", radiusM: a.result_radius_m ?? undefined,
        });
      }
    });
    // El GPS declarado, aparte y en ámbar. Nunca mezclado con lo inferido.
    if (image?.exif_lat != null && image.exif_lng != null) {
      out.push({ id: "exif", lat: image.exif_lat, lng: image.exif_lng, label: "E", kind: "exif" });
    }
    return out;
  }, [mine, image, shown]);

  const flyTo = useMemo(
    () =>
      shown?.result_lat != null && shown.result_lng != null
        ? { lat: shown.result_lat, lng: shown.result_lng, zoom: 13 }
        : image?.exif_lat != null && image.exif_lng != null
          ? { lat: image.exif_lat, lng: image.exif_lng, zoom: 13 }
          : null,
    [shown, image],
  );

  const free = usage ? usage.limit_gb * GB - usage.used_bytes : null;
  // Depende de `images` y no de `list`, que es un array nuevo en cada render.
  const stagedImages = useMemo(
    () => (staged ?? [])
      .map((id) => (images ?? []).find((im) => im.id === id))
      .filter((x): x is Image => !!x),
    [staged, images],
  );
  // El popup sobrevive a su propio cierre 180 ms para poder animarse, y en ese
  // rato `staged` ya es null: hay que quedarse con la última lista no vacía.
  const lastStaged = useRef<Image[]>([]);
  if (stagedImages.length > 0) lastStaged.current = stagedImages;

  return (
    <div className="relative h-full w-full"
      style={{ animation: "jg-page-fade-in 260ms cubic-bezier(.16,1,.3,1) both" }}>
      <MapCanvas markers={markers} flyTo={flyTo} onMarker={(id) => {
        if (id.startsWith("a")) setSelAnalysis(Number(id.slice(1)));
      }} />
      {rail}

      <TopBar
        crumbs={[
          { label: "Proyectos", onClick: onProjects },
          { label: project.name, onClick: onBack },
          { label: case_.name },
        ]}
        right={
          <span className="font-mono text-[10px] text-subtle">
            {list.length} {list.length === 1 ? "imagen" : "imágenes"} · {analyses.length}{" "}
            {analyses.length === 1 ? "análisis" : "análisis"}
          </span>
        } />

      {dragging && <DropFrame />}

      {images !== null && list.length === 0 ? (
        <DropTarget dragging={dragging} busy={busy} freeBytes={free}
          projectId={project.id} caseId={case_.id}
          onPick={() => void pick()} onReuse={(ids) => void reuse(ids)} />
      ) : (
        <>
          <ResultCard analysis={shown} image={image} offset={hasResults ? SIDEBAR : 0} />
          <Filmstrip images={list} selected={sel} shifted={hasResults}
            onSelect={(id) => { setSel(id); setSelAnalysis(null); }}
            onAdd={() => void pick()} />
          {hasResults ? (
            <ResultsSidebar image={image} analyses={mine} selected={shown?.id ?? null}
              onSelect={setSelAnalysis} busy={busy}
              onAnalyze={() => (sel !== null ? setStaged([sel]) : void pick())} />
          ) : (
            // Sin barra lateral no habría ninguna puerta para lanzar el
            // análisis de una imagen que ya está en el caso: el «+» de la tira
            // abre el selector de archivos, no el popup. Este botón es esa
            // puerta, y vive junto a la miniatura que va a analizar.
            sel !== null && (
              <button onClick={() => setStaged([sel])} disabled={busy}
                style={{ animation: "jg-fade-rise 240ms cubic-bezier(.16,1,.3,1) both" }}
                className="jg-press absolute bottom-[58px] right-4 z-20 rounded-lg bg-accent
                  px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-40">
                {busy ? "Un momento…" : "Analizar esta imagen"}
              </button>
            )
          )}
          <SummaryBar analysis={shown} rightInset={hasResults ? SIDEBAR : 0} />
        </>
      )}

      {/* El error de fuera del popup necesita su propio sitio: si no, un fallo
          al soltar imágenes en un caso lleno no se vería en ninguna parte. */}
      {error !== null && staged === null && (
        <div className="absolute bottom-3 left-1/2 z-30 flex max-w-[420px] -translate-x-1/2 items-start gap-2
          rounded-lg border border-danger/40 bg-[rgba(24,18,18,.94)] px-3 py-2 backdrop-blur"
          style={{ animation: "jg-toast-in 240ms cubic-bezier(.16,1,.3,1) both" }}>
          <p className="text-[10.5px] leading-snug text-danger-fg">{error}</p>
          <button onClick={() => setError(null)} className="jg-press shrink-0 text-subtle hover:text-fg">✕</button>
        </div>
      )}

      {popup.rendered && (
        <UploadPopup
          images={stagedImages.length > 0 ? stagedImages : lastStaged.current}
          caseName={case_.name} models={models} closing={popup.closing}
          busy={busy} error={error}
          onAddMore={() => void pick()}
          onDiscard={(id) => void discard(id)}
          onAnalyze={(m) => void analyze(m, staged ?? [])}
          onClose={() => { setStaged(null); setError(null); }} />
      )}
    </div>
  );
}
