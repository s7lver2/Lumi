import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { api, type Analysis, type Cambio, type Case, type Image, type Project, type Usage } from "../lib/api";
import { pickPaths, uploadPaths } from "../lib/bridge";
import { KNOWN_MODELS } from "../lib/models";
import { useServer } from "../lib/store";
import { useDismissable } from "../lib/useDismissable";
import { ContextMenu, type MenuState } from "../ui/ContextMenu";
import { Dock, type ImgState } from "./Dock";
import { DrawerTab, DRAWER_W, type DrawerId } from "./Drawer";
import { DropFrame, DropTarget } from "./DropTarget";
import { MapCanvas, type Marker } from "./MapCanvas";
import { ResultsDrawer } from "./ResultsDrawer";
import { UploadPopup } from "./UploadPopup";

const GB = 1024 * 1024 * 1024;

export function CaseView({
  project, case_, rail, drawer, drawerId, setDrawer,
}: {
  project: Project;
  case_: Case;
  rail: React.ReactNode;
  /** El cajón de invitar lo monta App: vale igual aquí y en la lista de casos. */
  drawer: React.ReactNode;
  drawerId: DrawerId;
  setDrawer: (d: DrawerId) => void;
}) {
  const token = useServer((s) => s.token) ?? undefined;
  const isAdmin = useServer((s) => s.isAdmin);
  const rawModels = useServer((s) => s.limits?.models) ?? [];
  // El servidor deja pasar cualquier modelo a un administrador; la cuenta del
  // owner nace con `["mini"]` porque nunca pasa por «aprobar una solicitud»,
  // que es donde se conceden los demás.
  const models = isAdmin ? Array.from(new Set([...rawModels, ...KNOWN_MODELS])) : rawModels;

  const [images, setImages] = useState<Image[] | null>(null);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [selAnalysis, setSelAnalysis] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [fly, setFly] = useState<{ lat: number; lng: number; zoom: number } | null>(null);
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

  // Antes esto solo se leía al montar: un análisis lanzado se quedaba
  // «pendiente» en pantalla para siempre aunque el servidor ya lo hubiera
  // resuelto. Ahora el servidor avisa.
  useEffect(() => {
    const un = listen<Cambio>("queue-change", (e) => {
      const c = e.payload;
      if (c.tipo !== "estado" || c.case_id !== case_.id) return;
      // Se recarga en vez de parchear la fila: el cambio de estado trae
      // coordenadas, radio y confianza, y reconstruirlos aquí sería duplicar
      // lo que la ruta ya sabe montar.
      void load();
    });
    return () => { void un.then((f) => f()); };
  }, [case_.id]);

  const list = images ?? [];

  async function add(paths: string[]) {
    if (paths.length === 0) return;
    setBusy(true); setError(null);
    try {
      const nuevas = await uploadPaths(case_.id, paths);
      if (nuevas.length) {
        setImages((v) => [...(v ?? []), ...nuevas]);
        setSel(nuevas[0].id);
        setStaged((s) => [...(s ?? []), ...nuevas.map((n) => n.id)]);
      }
      api.get<Usage>("/v1/me/usage", token).then(setUsage).catch(() => {});
    } catch (e) {
      setError(String(e));
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

  /** Copiar imágenes de otro caso del mismo proyecto. Es copia, no traslado. */
  async function reuse(imageIds: number[]) {
    if (imageIds.length === 0) return;
    setBusy(true); setError(null);
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
  // bytes, así que va por el mismo camino que el selector de archivos.
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
    setBusy(true); setError(null);
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

  /** Un análisis por imagen: el motor todavía no sabe cruzar varias. */
  async function analyze(model: string, ids: number[]) {
    if (ids.length === 0) return;
    setBusy(true); setError(null);
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
  const shown = useMemo(
    () => mine.find((a) => a.id === selAnalysis) ?? mine.find((a) => a.state === "hecho") ?? mine[0] ?? null,
    [mine, selAnalysis],
  );
  const hasResults = mine.length > 0 || (image?.exif_lat != null && image.exif_lng != null);

  // El cajón de resultados se abre solo la primera vez que hay algo que
  // enseñar; a partir de ahí manda quien lo abrió o lo cerró.
  const abiertoYa = useRef(false);
  useEffect(() => {
    if (hasResults && !abiertoYa.current && drawerId === null) {
      abiertoYa.current = true;
      setDrawer("results");
    }
  }, [hasResults, drawerId]);

  /** En qué anda cada imagen: el más avanzado de sus análisis manda. */
  const estados = useMemo(() => {
    const m = new Map<number, ImgState>();
    const rango: Record<string, number> = { error: 0, pendiente: 1, en_curso: 2, hecho: 3 };
    for (const a of analyses) {
      for (const id of a.image_ids) {
        const antes = m.get(id);
        if (!antes || rango[a.state] > rango[antes]) m.set(id, a.state as ImgState);
      }
    }
    return m;
  }, [analyses]);

  /** Puesto en la cola, contando solo lo que está esperando. */
  const cola = useMemo(() => {
    const espera = analyses
      .filter((a) => a.state === "pendiente")
      .sort((a, b) => a.created_at - b.created_at);
    const m = new Map<number, number>();
    espera.forEach((a, i) => a.image_ids.forEach((id) => { if (!m.has(id)) m.set(id, i + 1); }));
    return m;
  }, [analyses]);

  const markers: Marker[] = useMemo(() => {
    const out: Marker[] = [];
    mine.forEach((a, i) => {
      // Sin candidatos NO se pinta nada: un marcador donde no hay respuesta
      // se lee como que la hay.
      if (a.result_lat == null || a.result_lng == null) return;
      const esElMostrado = a.id === shown?.id;
      out.push({
        id: `a${a.id}`, lat: a.result_lat, lng: a.result_lng, label: String(i + 1),
        kind: esElMostrado ? "top" : "alt", radiusM: a.result_radius_m ?? undefined,
      });
      // Las alternativas del análisis que se está mirando: el motor dudó
      // entre varias zonas, y esas zonas se pintan perfiladas y más tenues.
      if (esElMostrado) {
        a.hypotheses.forEach((h, j) => {
          out.push({
            id: `a${a.id}h${j}`, lat: h.lat, lng: h.lng, label: String(i + 2 + j),
            kind: "alt", radiusM: h.radio_m,
          });
        });
      }
    });
    if (image?.exif_lat != null && image.exif_lng != null) {
      out.push({ id: "exif", lat: image.exif_lat, lng: image.exif_lng, label: "E", kind: "exif" });
    }
    return out;
  }, [mine, image, shown]);

  const flyTo = useMemo(
    () =>
      fly ??
      (shown?.result_lat != null && shown.result_lng != null
        ? { lat: shown.result_lat, lng: shown.result_lng, zoom: 13 }
        : image?.exif_lat != null && image.exif_lng != null
          ? { lat: image.exif_lat, lng: image.exif_lng, zoom: 13 }
          : null),
    [shown, image, fly],
  );

  const free = usage ? usage.limit_gb * GB - usage.used_bytes : null;
  const stagedImages = useMemo(
    () => (staged ?? [])
      .map((id) => (images ?? []).find((im) => im.id === id))
      .filter((x): x is Image => !!x),
    [staged, images],
  );
  // El popup sobrevive a su cierre 180 ms para animarse, y en ese rato `staged`
  // ya es null: hay que quedarse con la última lista no vacía.
  const lastStaged = useRef<Image[]>([]);
  if (stagedImages.length > 0) lastStaged.current = stagedImages;

  const inset = drawerId === null ? 0 : DRAWER_W;
  const vacio = images !== null && list.length === 0;

  return (
    // `absolute inset-0` y no `relative h-full w-full`: con `h-full` la altura
    // dependía de que la cadena flex de arriba la resolviera, y no lo hacía —
    // el lienzo del mapa acababa midiendo 1067×0 y MapLibre cargaba «bien» sin
    // tener dónde dibujar. Anclado a los cuatro bordes del contenedor no hay
    // cadena que resolver.
    <div className="absolute inset-0 overflow-hidden"
      style={{ animation: "jg-page-fade-in 260ms cubic-bezier(.16,1,.3,1) both" }}>
      <MapCanvas markers={markers} flyTo={flyTo} onMarker={(id) => {
        // "a123" es un análisis; "a123h0" es una de sus alternativas y
        // selecciona el mismo análisis, que es lo que ya sabe pintar el cajón.
        const m = /^a(\d+)/.exec(id);
        if (m) setSelAnalysis(Number(m[1]));
      }} />
      {rail}

      {dragging && <DropFrame />}

      {vacio ? (
        <DropTarget dragging={dragging} busy={busy} freeBytes={free}
          projectId={project.id} caseId={case_.id}
          onPick={() => void pick()} onReuse={(ids) => void reuse(ids)} />
      ) : (
        <>
          <DrawerTab shifted={drawerId !== null} open={drawerId === "results"}
            onClick={() => setDrawer(drawerId === "results" ? null : "results")} />
          <ResultsDrawer open={drawerId === "results"} image={image} analyses={mine}
            selected={shown?.id ?? null} busy={busy}
            onSelect={setSelAnalysis}
            onAnalyze={() => (sel !== null ? setStaged([sel]) : void pick())}
            onCenter={(lat, lng) => setFly({ lat, lng, zoom: 14 })}
            onMenu={setMenu} />
        </>
      )}

      {drawer}

      <Dock images={list} selected={sel}
        stateOf={(id) => estados.get(id) ?? null}
        queueOf={(id) => cola.get(id) ?? null}
        summary={{ analysis: shown, image, caseName: case_.name }}
        primaryLabel={list.length === 0 ? "Añadir imágenes" : "Analizar"}
        busy={busy} rightInset={inset}
        onSelect={(id) => { setSel(id); setSelAnalysis(null); setFly(null); }}
        onAdd={() => void pick()}
        onPrimary={() => (list.length === 0 || sel === null ? void pick() : setStaged([sel]))} />

      {error !== null && staged === null && (
        <div className="absolute bottom-[66px] left-1/2 z-30 flex max-w-[420px] -translate-x-1/2 items-start
          gap-2 rounded-lg border border-danger/40 bg-[rgba(24,18,18,.94)] px-3 py-2 backdrop-blur"
          style={{ animation: "jg-toast-in 240ms cubic-bezier(.16,1,.3,1) both" }}>
          <p className="text-[10.5px] leading-snug text-danger-fg">{error}</p>
          <button onClick={() => setError(null)} className="jg-press shrink-0 text-subtle hover:text-fg">✕</button>
        </div>
      )}

      <ContextMenu state={menu} onClose={() => setMenu(null)} />

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
