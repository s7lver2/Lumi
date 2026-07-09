// apps/web/app/components/SearchDashboard.tsx
"use client";

import { useEffect, useState } from "react";
import { MapCanvas } from "./MapCanvas";
import { ImageDropzone } from "./ImageDropzone";
import { ConfidenceCircleLayer } from "./ConfidenceCircleLayer";
import { ResultsPanel } from "./ResultsPanel";
import { TopResultCard } from "./TopResultCard";
import { BottomSummaryBar } from "./BottomSummaryBar";
import { useSearchStore } from "../stores/useSearchStore";
import { useMapStore } from "../stores/useMapStore";

export function SearchDashboard() {
  const [map, setMap] = useState<any>(null);
  const [queryImageUrl, setQueryImageUrl] = useState<string | null>(null);
  const { refineStatus, regions, error, setSearching, setSearchResults, setError } = useSearchStore();
  const setMode = useMapStore((s) => s.setMode);

  useEffect(() => {
    setMode("search");
  }, [setMode]);

  async function handleImage(file: File) {
    setQueryImageUrl(URL.createObjectURL(file));
    setSearching(file.name);
    const form = new FormData();
    form.append("image", file);
    const res = await fetch("/api/search", { method: "POST", body: form });
    const json = await res.json();
    if (!res.ok) return setError(json.error ?? "La búsqueda falló");
    setSearchResults(json, file.name);
  }

  // apps/web/app/components/SearchDashboard.tsx — add inside the component
  const { currentSearchId, setRefining, setRefineResults, selectRegion } = useSearchStore();

  async function handleRefine(regionId: string) {
    if (!currentSearchId) return;
    selectRegion(regionId);
    setRefining();
    const res = await fetch(`/api/search/${currentSearchId}/refine`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ regionId }),
    });
    const json = await res.json();
    if (!res.ok) return setError(json.error ?? "El refinado falló");
    setRefineResults(regionId, json.candidates);
    // Zoom to the refined region for the street-level view.
    const region = regions.find((r) => r.id === regionId);
    if (map && region) {
      map.flyTo({ center: [region.centroid.lng, region.centroid.lat], zoom: 16, pitch: 55, duration: 900 });
    }
  }

  // Fit the map to the returned regions once results arrive.
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

  const idle = refineStatus === "idle";
  const searching = refineStatus === "searching";

  return (
    <>
      <MapCanvas onReady={(m) => setMap(m)} />
      {map && <ConfidenceCircleLayer map={map} />}

      {idle && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <ImageDropzone onImage={handleImage} />
        </div>
      )}

      {searching && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-card bg-panel/80 px-5 py-3 text-sm text-fg backdrop-blur-md">
          Localizando…
        </div>
      )}

      {regions.length > 0 && (
        <>
          <TopResultCard onRefine={() => {}} />
          <div className="absolute right-0 top-0 h-full">
            <ResultsPanel queryImageUrl={queryImageUrl} onRefine={() => {}} />
          </div>
          <BottomSummaryBar />
        </>
      )}

      {error && (
        <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-card bg-danger/20 px-4 py-2 text-xs text-danger-fg">
          {error}
        </div>
      )}
    </>
  );
}