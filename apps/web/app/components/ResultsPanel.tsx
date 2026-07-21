// apps/web/app/components/ResultsPanel.tsx
"use client";

import { useState } from "react";
import { useSearchStore } from "../stores/useSearchStore";
import { CandidateComparisonCard } from "./CandidateComparisonCard";
import { OtherCandidatesList } from "./OtherCandidatesList";
import { WidgetGrid } from "./WidgetGrid";
import { ResultsWidgetsPopup } from "./ResultsWidgetsPopup";
import { ExifMetadataWidget } from "./widgets/ExifMetadataWidget";
import { EstimatedTimeWidget, SUN_ICON } from "./widgets/EstimatedTimeWidget";
import { WeatherEstimateWidget, WEATHER_ICON } from "./widgets/WeatherEstimateWidget";
import { DetectedObjectsWidget, OBJECTS_ICON } from "./widgets/DetectedObjectsWidget";
import type { Widget } from "./widgets/types";
import { hourForLabel } from "../../lib/time-of-day";

const SEARCH_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

// No real model behind these three yet (Tasks 20-21) — always locked,
// no install endpoint to call, so onInstall is a no-op. Matches how these
// widgets already render standalone (never wired into ResultsPanel before
// this task).
function noop() {}

export function ResultsPanel({
  queryImageUrl,
  queryImageId,
  onRefineCandidate,
  refining = false,
}: {
  queryImageUrl: string | null;
  queryImageId: string | null;
  onRefineCandidate: (candidateId: string, regionId: string) => void;
  refining?: boolean;
}) {
  const { queryImageName, candidatesByRegion, selectedRegionId } = useSearchStore();
  const candidates = selectedRegionId ? candidatesByRegion[selectedRegionId] ?? [] : [];
  const [top, ...rest] = candidates;
  const timeOfDay = useSearchStore((s) => s.timeOfDay);
  const estimatedHour = timeOfDay ? hourForLabel(timeOfDay.label) : null;
  const weather = useSearchStore((s) => s.weather);
  const [popupOpen, setPopupOpen] = useState(false);

  const widgets: Widget[] = [
    {
      id: "search-results",
      title: "Resultado",
      icon: SEARCH_ICON,
      colSpan: 4,
      locked: false,
      defaultExpanded: true,
      render: () => (
        <>
          <div className="flex items-center gap-3 pb-3">
            {queryImageUrl && <img src={queryImageUrl} alt="" className="h-14 w-14 rounded-md object-cover" />}
            <span className="truncate font-mono text-xs text-muted">{queryImageName}</span>
          </div>
          {top && (
            <CandidateComparisonCard
              candidate={top}
              queryImageUrl={queryImageUrl}
              showZoneRefine={true}
              onRefineCandidate={onRefineCandidate}
              refining={refining}
            />
          )}
          <OtherCandidatesList
            candidates={rest}
            queryImageUrl={queryImageUrl}
            onRefineCandidate={onRefineCandidate}
            refining={refining}
          />
        </>
      ),
    },
    {
      id: "exif",
      title: "Metadatos EXIF",
      icon: SEARCH_ICON,
      colSpan: 2,
      locked: false,
      defaultExpanded: true,
      render: () => (queryImageId ? <ExifMetadataWidget imageId={queryImageId} estimatedTime={null} /> : <div className="text-[9.5px] text-muted">Sin imagen de consulta.</div>),
    },
    {
      id: "estimated-time",
      title: "Hora estimada",
      icon: SUN_ICON,
      tooltip: "Estimado a partir del largo y dirección de las sombras visibles en la foto",
      colSpan: 2,
      locked: estimatedHour === null,
      defaultExpanded: estimatedHour !== null,
      render: () => <EstimatedTimeWidget locked={estimatedHour === null} estimatedHour={estimatedHour} onInstall={noop} />,
    },
    {
      id: "weather",
      title: "Clima estimado",
      icon: WEATHER_ICON,
      tooltip: "Clasificado a partir de la imagen (Wanda)",
      colSpan: 2,
      locked: weather === null,
      defaultExpanded: weather !== null,
      render: () => <WeatherEstimateWidget locked={weather === null} weather={weather} onInstall={noop} />,
    },
    {
      id: "detected-objects",
      title: "Objetos detectados",
      icon: OBJECTS_ICON,
      tooltip: "Detectado por un modelo de reconocimiento de objetos entrenado sobre escenas urbanas",
      colSpan: 2,
      locked: true,
      defaultExpanded: false,
      render: () => <DetectedObjectsWidget onInstall={noop} />,
    },
  ];

  return (
    <div className="relative flex h-full flex-col">
      <button
        onClick={() => setPopupOpen(true)}
        className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-md border border-white/15 bg-panel/80 text-subtle hover:text-fg"
        title="Expandir"
        aria-label="Expandir panel de resultados"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
        </svg>
      </button>
      <WidgetGrid columns={1} widgets={widgets} />
      {popupOpen && <ResultsWidgetsPopup widgets={widgets} onClose={() => setPopupOpen(false)} />}
    </div>
  );
}
