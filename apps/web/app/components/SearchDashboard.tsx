// apps/web/app/components/SearchDashboard.tsx
"use client";

import { useEffect, useState } from "react";
import { MapCanvas } from "./MapCanvas";
import { MapDropTarget } from "./MapDropTarget";
import { UploadPopup } from "./UploadPopup";
import { ConfidenceCircleLayer } from "./ConfidenceCircleLayer";
import { ResultsPanel } from "./ResultsPanel";
import { BottomSummaryBar } from "./BottomSummaryBar";
import { useSearchStore } from "../stores/useSearchStore";
import { useMapStore } from "../stores/useMapStore";
import { fetchJson } from "../lib/fetch-json";
import { flyToRegion, flyToPoint } from "../lib/map-camera";
import { MapArrivalPulse } from "./MapArrivalPulse";
import { ModelLoadNotification } from "./ModelLoadNotification";
import { RETRIEVAL_MODELS } from "@netryx/shared-types";

interface SelectedFile {
  file: File;
  url: string;
  displayName: string;
}

function formatEta(etaMs: number | null): string {
  if (etaMs === null) return "calculando…";
  const totalSeconds = Math.round(etaMs / 1000);
  if (totalSeconds < 60) return `~${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `~${minutes}m ${seconds}s`;
}

export function SearchDashboard() {
  const activeModelId = RETRIEVAL_MODELS[0]?.id ?? "lumi-preview";
  const [map, setMap] = useState<any>(null);
  const [queryImageUrl, setQueryImageUrl] = useState<string | null>(null);
  const [queryImageId, setQueryImageId] = useState<string | null>(null);

  const { 
    refineStatus, 
    refineProgress, 
    regions, 
    error,
    setSearching,
    setSearchResults,
    setError,
    dismissError,
    candidatesByRegion,
    currentSearchId, 
    setRefining, 
    setRefineProgress, 
    setRefineResults, 
    selectRegion,
    setBatchProgress,
    batchProgress
  } = useSearchStore();
  
  const setMode = useMapStore((s) => s.setMode);

  const [selected, setSelected] = useState<SelectedFile[]>([]);
  const [pulsePoint, setPulsePoint] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    setMode("search");
  }, [setMode]);

  function pollBatchProgress(batchId: string, queryImageName: string) {
    const source = new EventSource(`/api/search/batch/${batchId}/progress`);
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as {
        status: string;
        done: number;
        failed: number;
        total: number;
        result?: import("@netryx/shared-types").SearchResponse | null;
      };
      setBatchProgress({ done: data.done, total: data.total, failed: data.failed });
      if (data.status === "done" || data.status === "failed") {
        source.close();
        setBatchProgress(null);
        if (data.status === "done" && data.result) {
          if (data.result.regions.length === 0) {
            // A legitimately completed search can still surface zero regions
            // (e.g. an empty index, or every candidate falling below
            // DEFAULT_RELATIVE_SIMILARITY_FLOOR) — previously this rendered
            // nothing at all (regions.length > 0 gates the whole
            // ResultsPanel), so the notification vanished with no
            // explanation of why the screen stayed empty.
            setError("No se encontraron coincidencias para esta imagen. Prueba con otra foto o revisa que la zona esté indexada.");
          } else {
            setSearchResults(data.result, queryImageName);
            // The default map view is the whole planet until a search
            // resolves (spec: zoom-out-then-fly-in) — without an explicit
            // fly here, a freshly found region's confidence circle exists
            // on the map but is geographically invisible at that zoom.
            const topRegion = [...data.result.regions].sort((a, b) => b.aggregateScore - a.aggregateScore)[0];
            if (topRegion) flyToRegion(map, topRegion);
          }
        } else {
          setError("No se pudo completar la búsqueda para ninguna de las imágenes");
        }
      }
    };
    source.onerror = () => {
      source.close();
      setBatchProgress(null);
      setError("Se perdió la conexión con el progreso de la búsqueda");
    };
  }

  async function handleTriggerSearch() {
    if (selected.length === 0) return;

    const queryImageName = selected[0].displayName;
    const queryImageUrlSnapshot = selected[0].url;

    try {
      setSearching(queryImageName);
      setQueryImageUrl(queryImageUrlSnapshot);
      const imageIds: string[] = [];
      
      for (const s of selected) {
        // Si el archivo ya tiene un ID asignado por el flujo de MapDropTarget, lo usamos directamente.
        // De lo contrario, se sube en este momento (mecanismo fallback).
        if (s.file.name.match(/^[0-9a-fA-F-]{36}$/)) {
          imageIds.push(s.file.name);
        } else {
          const form = new FormData();
          form.append("image", s.file);
          const { ok, data } = await fetchJson<{ image: { id: string } }>("/api/library", { method: "POST", body: form });
          if (!ok || !data) throw new Error("No se pudo añadir la imagen a la librería");
          imageIds.push(data.image.id);
        }
      }

      const { ok, data } = await fetchJson<{ batchId: string }>("/api/search/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageIds, modelId: activeModelId }),
      });
      if (!ok || !data) throw new Error("No se pudo iniciar la búsqueda por lotes");

      setQueryImageId(imageIds[0] ?? null);
      pollBatchProgress(data.batchId, queryImageName);

      // Keep selected[0].url alive — it's now shown as the query thumbnail
      // (queryImageUrl) for the duration of this search.
      selected.slice(1).forEach((s) => URL.revokeObjectURL(s.url));
      setSelected([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar la búsqueda por lotes");
    }
  }

  async function handleRefine(regionId: string) {
    if (!currentSearchId) return;
    selectRegion(regionId);
    setRefining();

    const res = await fetch(`/api/models/${activeModelId}/refine`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ searchId: currentSearchId, regionId }),
    });
    if (!res.ok || !res.body) return setError(`El refinado falló (HTTP ${res.status})`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const raw = part.replace(/^data: /, "");
        if (!raw) continue;
        const event = JSON.parse(raw) as
          | { type: "progress"; verified: number; total: number; etaMs: number | null }
          | { type: "done"; result: { candidates: import("@netryx/shared-types").SearchCandidate[] } }
          | { type: "error"; message: string };
        if (event.type === "progress") {
          setRefineProgress({ verified: event.verified, total: event.total, etaMs: event.etaMs });
        } else if (event.type === "done") {
          setRefineResults(regionId, event.result.candidates);
        } else if (event.type === "error") {
          setError(event.message);
        }
      }
    }

    const region = regions.find((r) => r.id === regionId);
    const confirmed = (candidatesByRegion[regionId] ?? []).find((c) => c.status === "confirmed");
    if (confirmed) {
      flyToPoint(map, confirmed);
      setPulsePoint({ lat: confirmed.lat, lng: confirmed.lng });
    } else if (region) {
      flyToRegion(map, region);
    }
  }

  async function handleRefineCandidate(candidateId: string, regionId: string) {
    if (!currentSearchId) return;
    selectRegion(regionId);
    setRefining();

    const res = await fetch(`/api/models/${activeModelId}/refine`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ searchId: currentSearchId, regionId, candidateId }),
    });
    if (!res.ok || !res.body) return setError(`El refinado falló (HTTP ${res.status})`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const raw = part.replace(/^data: /, "");
        if (!raw) continue;
        const event = JSON.parse(raw) as
          | { type: "progress"; verified: number; total: number; etaMs: number | null }
          | { type: "done"; result: { candidates: import("@netryx/shared-types").SearchCandidate[] } }
          | { type: "error"; message: string };
        if (event.type === "progress") {
          setRefineProgress({ verified: event.verified, total: event.total, etaMs: event.etaMs });
        } else if (event.type === "done") {
          setRefineResults(regionId, event.result.candidates);
        } else if (event.type === "error") {
          setError(event.message);
        }
      }
    }
  }

  useEffect(() => {
    if (!map || regions.length === 0) return;
    const lngs = regions.map((r) => r.centroid.lng);
    const lats = regions.map((r) => r.centroid.lat);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 120, maxZoom: 14, duration: 800 }
    );
  }, [map, regions]);

  // Se añade soporte inmediato a la subida a la librería para evitar fallos de ID inexistente al recortar
  async function handleFilesDropped(files: File[]) {
    if (files.length === 0) return;
    
    try {
      const formatted = await Promise.all(
        files.map(async (file) => {
          const form = new FormData();
          form.append("image", file);
          const { ok, data } = await fetchJson<{ image: { id: string; filename: string } }>("/api/library", { method: "POST", body: form });
          if (!ok || !data) throw new Error("No se pudo añadir la imagen a la librería");
          // Guardamos el ID retornado en el name del archivo para mapeos subsecuentes (PATCH/Crop)
          const trackedFile = new File([file], data.image.id, { type: file.type });
          return { file: trackedFile, url: URL.createObjectURL(file), displayName: data.image.filename };
        })
      );
      setSelected((prev) => [...prev, ...formatted]);
    } catch (err) {
      setError("Error al procesar e integrar los archivos en la librería remota.");
    }
  }

  function handleRemove(index: number) {
    setSelected((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) URL.revokeObjectURL(removed.url);
      return next;
    });
  }

  const idle = refineStatus === "idle";
  const searching = refineStatus === "searching";
  const refining = refineStatus === "refining";
  // A batch-search failure (bad image, no candidates above the similarity
  // floor, worker/inference down, etc.) leaves refineStatus "error" with no
  // regions ever having arrived — previously the drop target stayed hidden
  // (gated on idle only) and selected[] was already cleared before the
  // failure, so the user was stuck looking at the error banner with no way
  // to try again short of a full page reload. A refine (Pass 2) failure is
  // different: regions are already populated from a prior successful search,
  // so that case keeps the results panel up instead of reopening the drop
  // target.
  const canRetryDrop = idle || (refineStatus === "error" && regions.length === 0);

  return (
    <>
      <MapCanvas onReady={(m) => setMap(m)} />
      {map && <ConfidenceCircleLayer map={map} />}
      {map && <MapArrivalPulse map={map} point={pulsePoint} />}

      {canRetryDrop && selected.length === 0 && (
        <MapDropTarget
          onImagesReady={(images) => {
            Promise.all(
              images.map(async ({ id, filename }) => {
                const res = await fetch(`/api/library/${id}/bytes`);
                if (!res.ok) return null;
                const blob = await res.blob();
                const file = new File([blob], id, { type: blob.type });
                return { file, url: URL.createObjectURL(blob), displayName: filename };
              })
            ).then((results) => {
              const ready = results.filter((r): r is SelectedFile => r !== null);
              if (ready.length < results.length) {
                setError("Alguna imagen ya no está disponible en la librería y se omitió.");
              }
              setSelected((prev) => [...prev, ...ready]);
            });
          }}
        />
      )}

      <UploadPopup
        files={selected}
        onAddMore={handleFilesDropped}
        onRemove={handleRemove}
        onSearch={handleTriggerSearch}
        busy={searching}
        onCropSave={async (index, croppedFile) => {
          const imageId = selected[index].file.name;
          const form = new FormData();
          form.append("image", croppedFile);
          await fetch(`/api/library/${imageId}`, { method: "PATCH", body: form });
          setSelected((prev) => {
            const next = [...prev];
            URL.revokeObjectURL(next[index].url);
            next[index] = { file: croppedFile, url: URL.createObjectURL(croppedFile), displayName: next[index].displayName };
            return next;
          });
        }}
      />

      <ModelLoadNotification
        active={searching || refining}
        thumbnailUrl={queryImageUrl}
        fallbackLabel={
          searching
            ? batchProgress
              ? `Escaneando ${batchProgress.done}/${batchProgress.total}…`
              : "Buscando…"
            : "Verificando…"
        }
      />

      {error && (
        <div className="fixed bottom-4 right-4 z-40 flex w-[280px] items-start gap-2.5 rounded-lg border border-danger/40 bg-panel/[.97] p-3 shadow-lg shadow-black/40">
          <span className="mt-0.5 text-danger">⚠</span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-medium text-fg">No se pudo completar</div>
            <div className="mt-0.5 text-[10.5px] leading-snug text-muted">{error}</div>
          </div>
          <button
            onClick={dismissError}
            className="text-subtle hover:text-fg"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
      )}

      {regions.length > 0 && (
        <>
          <div className="absolute right-0 top-0 h-full w-[520px]">
            <ResultsPanel
              queryImageUrl={queryImageUrl}
              queryImageId={queryImageId}
              onRefineCandidate={handleRefineCandidate}
              refining={refining}
            />
          </div>
          <BottomSummaryBar onRefine={handleRefine} refining={refining} />
        </>
      )}
    </>
  );
}