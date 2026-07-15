"use client";

import { useEffect, useState } from "react";
import { MapCanvas } from "./MapCanvas";
// Se remueve ImageDropzone y se importan los nuevos primitivos de arrastre del mapa
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

// Debe coincidir con el contrato `Selected` de UploadPopup ({ file, url }).
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
    candidatesByRegion 
  } = useSearchStore();
  const setMode = useMapStore((s) => s.setMode);

  // Estado local para capturar el archivo arrastrado sobre el lienzo del mapa
  const [selected, setSelected] = useState<SelectedFile[]>([]);
  // Estado local para el objetivo de la pulsación de llegada al mapa
  const [pulsePoint, setPulsePoint] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    setMode("search");
  }, [setMode]);

  // Manejador centralizado modificado para aceptar la referencia directa del File
  async function handleImage(file: File) {
    setQueryImageUrl(URL.createObjectURL(file));
    setSearching(file.name);
    const form = new FormData();
    form.append("image", file);
    const { ok, data } = await fetchJson("/api/search", { method: "POST", body: form });
    if (!ok || !data) return setError(data?.error ?? "La búsqueda falló");
    setSearchResults(data, file.name);
  }

  const { currentSearchId, setRefining, setRefineProgress, setRefineResults, selectRegion } = useSearchStore();

  function handleSelectRegion(regionId: string) {
    selectRegion(regionId);
    const region = regions.find((r) => r.id === regionId);
    if (region) flyToRegion(map, region);
  }

  // Streamed as SSE, not a single fetchJson call — refine can take minutes
  // (RoMa verification is ~10-25s PER CANDIDATE), so the route reports
  // progress/ETA per candidate as it goes (see the refine route's onProgress
  // wiring). Same parsing shape as useCommandRun.ts's setup-wizard SSE
  // consumer, just with refine-specific event types instead of log lines.
  async function handleRefine(regionId: string) {
    if (!currentSearchId) return;
    selectRegion(regionId);
    setRefining();

    const res = await fetch(`/api/search/${currentSearchId}/refine`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ regionId }),
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
    const confirmed = (
      candidatesByRegion[regionId] ?? []
    ).find((c) => c.status === "confirmed");
    if (confirmed) {
      flyToPoint(map, confirmed);
      setPulsePoint({ lat: confirmed.lat, lng: confirmed.lng });
    } else if (region) {
      flyToRegion(map, region);
    }
  }

  // Ajuste de encuadre (Fit Bounds) automático
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

  // Interceptores de archivos arrojados en la zona global del mapa
  function handleFilesDropped(files: File[]) {
    if (files.length === 0) return;
    const formatted = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setSelected((prev) => [...prev, ...formatted]);
  }

  function handleRemove(index: number) {
    setSelected((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) URL.revokeObjectURL(removed.url);
      return next;
    });
  }

  function handleTriggerSearch() {
    if (selected.length === 0) return;
    // Backend is single-image: search the first selected file (documented limit).
    handleImage(selected[0].file);
    selected.forEach((s) => URL.revokeObjectURL(s.url));
    setSelected([]);
  }

  const idle = refineStatus === "idle";
  const searching = refineStatus === "searching";
  const refining = refineStatus === "refining";

  return (
    <>
      <MapCanvas onReady={(m) => setMap(m)} />
      {map && <ConfidenceCircleLayer map={map} />}
      {map && <MapArrivalPulse map={map} point={pulsePoint} />}

      {/* Se expone de forma permanente sobre el mapa en estado idle el capturador drag-and-drop */}
      {idle && <MapDropTarget onFiles={handleFilesDropped} />}

      {/* Popup modal reactivo cuando existe al menos un archivo cargado en memoria */}
      {selected.length > 0 && (
        <UploadPopup
          files={selected}
          onAddMore={handleFilesDropped}
          onRemove={handleRemove}
          onSearch={handleTriggerSearch}
          busy={searching}
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
