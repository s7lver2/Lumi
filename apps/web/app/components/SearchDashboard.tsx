// apps/web/app/components/SearchDashboard.tsx
"use client";

import { useEffect, useState } from "react";
import { MapCanvas } from "./MapCanvas";
import { MapDropTarget } from "./MapDropTarget";
import { UploadPopup } from "./UploadPopup";
import { ConfidenceCircleLayer } from "./ConfidenceCircleLayer";
import { ResultsPanel } from "./ResultsPanel";
import { TopResultCard } from "./TopResultCard";
import { BottomSummaryBar } from "./BottomSummaryBar";
import { useSearchStore } from "../stores/useSearchStore";
import { useMapStore } from "../stores/useMapStore";
import { fetchJson } from "../lib/fetch-json";
import { flyToRegion, flyToPoint } from "../lib/map-camera";
import { MapArrivalPulse } from "./MapArrivalPulse";
import { ModelLoadingNotice } from "./ModelLoadingNotice";
import { RETRIEVAL_MODELS } from "@netryx/shared-types";

interface SelectedFile {
  file: File;
  url: string;
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
  
  const { 
    refineStatus, 
    refineProgress, 
    regions, 
    error, 
    setSearching, 
    setSearchResults, 
    setError,
    candidatesByRegion,
    currentSearchId, 
    setRefining, 
    setRefineProgress, 
    setRefineResults, 
    selectRegion,
    setBatchProgress
  } = useSearchStore();
  
  const setMode = useMapStore((s) => s.setMode);

  const [selected, setSelected] = useState<SelectedFile[]>([]);
  const [pulsePoint, setPulsePoint] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    setMode("search");
  }, [setMode]);

  function pollBatchProgress(batchId: string) {
    const source = new EventSource(`/api/search/batch/${batchId}/progress`);
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as { status: string; done: number; failed: number; total: number };
      setBatchProgress({ done: data.done, total: data.total, failed: data.failed });
      if (data.status === "done" || data.status === "failed") {
        source.close();
        setBatchProgress(null);
      }
    };
  }

  async function handleTriggerSearch() {
    if (selected.length === 0) return;

    try {
      setSearching(selected[0].file.name);
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

      pollBatchProgress(data.batchId);
      
      selected.forEach((s) => URL.revokeObjectURL(s.url));
      setSelected([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar la búsqueda por lotes");
    }
  }

  function handleSelectRegion(regionId: string) {
    selectRegion(regionId);
    const region = regions.find((r) => r.id === regionId);
    if (region) flyToRegion(map, region);
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
          const { ok, data } = await fetchJson<{ image: { id: string } }>("/api/library", { method: "POST", body: form });
          if (!ok || !data) throw new Error("No se pudo añadir la imagen a la librería");
          // Guardamos el ID retornado en el name del archivo para mapeos subsecuentes (PATCH/Crop)
          const trackedFile = new File([file], data.image.id, { type: file.type });
          return { file: trackedFile, url: URL.createObjectURL(file) };
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

  return (
    <>
      <MapCanvas onReady={(m) => setMap(m)} />
      {map && <ConfidenceCircleLayer map={map} />}
      {map && <MapArrivalPulse map={map} point={pulsePoint} />}

      {idle && (
        <MapDropTarget
          onImagesReady={(imageIds) => {
            Promise.all(
              imageIds.map(async (id) => {
                const res = await fetch(`/api/library/${id}/bytes`);
                const blob = await res.blob();
                const file = new File([blob], id, { type: blob.type });
                return { file, url: URL.createObjectURL(blob) };
              })
            ).then((newSelected) => setSelected((prev) => [...prev, ...newSelected]));
          }}
        />
      )}

      {selected.length > 0 && (
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
              next[index] = { file: croppedFile, url: URL.createObjectURL(croppedFile) };
              return next;
            });
          }}
        />
      )}

      {searching && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-card bg-panel/80 px-5 py-3 text-sm text-fg backdrop-blur-md z-40">
          Localizando…
          <ModelLoadingNotice active={searching} />
        </div>
      )}

      {regions.length > 0 && (
        <>
          <TopResultCard onRefine={handleRefine} onSelectRegion={handleSelectRegion} refining={refining} />
          <div className="absolute right-0 top-0 h-full">
            <ResultsPanel queryImageUrl={queryImageUrl} onRefine={handleRefine} onSelectRegion={handleSelectRegion} refining={refining} />
          </div>
        </>
      )}
    </>
  );
}