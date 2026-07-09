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

// Estructura de tipado local requerida por el UploadPopup
interface SelectedFile {
  id: string;
  file: File;
}

export function SearchDashboard() {
  const [map, setMap] = useState<any>(null);
  const [queryImageUrl, setQueryImageUrl] = useState<string | null>(null);
  const { refineStatus, regions, error, setSearching, setSearchResults, setError } = useSearchStore();
  const setMode = useMapStore((s) => s.setMode);

  // Estado local para capturar el archivo arrastrado sobre el lienzo del mapa
  const [selected, setSelected] = useState<SelectedFile[]>([]);

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

  const { currentSearchId, setRefining, setRefineResults, selectRegion } = useSearchStore();

  async function handleRefine(regionId: string) {
    if (!currentSearchId) return;
    selectRegion(regionId);
    setRefining();
    const { ok, data } = await fetchJson(`/api/search/${currentSearchId}/refine`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ regionId }),
    });
    if (!ok || !data) return setError(data?.error ?? "El refinado falló");
    setRefineResults(regionId, data.candidates);
    
    const region = regions.find((r) => r.id === regionId);
    if (map && region) {
      map.flyTo({ center: [region.centroid.lng, region.centroid.lat], zoom: 16, pitch: 55, duration: 900 });
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
    // Mapeamos los archivos entrantes al formato de colección esperado por el popup
    const formatted = files.map((file) => ({
      id: `${file.name}-${Date.now()}`,
      file,
    }));
    setSelected(formatted);
  }

  function handleTriggerSearch() {
    if (selected.length === 0) return;
    // Se ejecuta la búsqueda usando el primer elemento de la cola
    handleImage(selected[0].file);
    // Limpiamos el overlay una vez enviada la petición
    setSelected([]);
  }

  const idle = refineStatus === "idle";
  const searching = refineStatus === "searching";

  return (
    <>
      <MapCanvas onReady={(m) => setMap(m)} />
      {map && <ConfidenceCircleLayer map={map} />}

      {/* Se expone de forma permanente sobre el mapa en estado idle el capturador drag-and-drop */}
      {idle && <MapDropTarget onFiles={handleFilesDropped} />}

      {/* Popup modal reactivo cuando existe al menos un archivo cargado en memoria */}
      {selected.length > 0 && (
        <UploadPopup
          files={selected}
          onClose={() => setSelected([])}
          onSearch={handleTriggerSearch}
          // 💡 Nota sobre Recorte: El asistente de recorte (crop helper) queda diferido
          // o accesible de forma opcional vinculando un callback al hacer clic sobre el thumbnail.
        />
      )}

      {searching && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-card bg-panel/80 px-5 py-3 text-sm text-fg backdrop-blur-md z-40">
          Localizando…
        </div>
      )}

      {regions.length > 0 && (
        <>
          <TopResultCard onRefine={handleRefine} />
          <div className="absolute right-0 top-0 h-full">
            <ResultsPanel queryImageUrl={queryImageUrl} onRefine={handleRefine} />
          </div>
          <BottomSummaryBar />
        </>
      )}

      {error && (
        <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-card bg-danger/20 px-4 py-2 text-xs text-danger-fg z-50">
          {error}
        </div>
      )}
    </>
  );
}