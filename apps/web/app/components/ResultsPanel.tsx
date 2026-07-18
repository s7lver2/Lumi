// apps/web/app/components/ResultsPanel.tsx
"use client";

import { useSearchStore } from "../stores/useSearchStore";
import { CandidateComparisonCard } from "./CandidateComparisonCard";
import { OtherCandidatesList } from "./OtherCandidatesList";
import { WidgetGrid } from "./WidgetGrid";
import { ExifMetadataWidget } from "./widgets/ExifMetadataWidget";
import { EstimatedTimeWidget } from "./widgets/EstimatedTimeWidget";
import { WeatherEstimateWidget } from "./widgets/WeatherEstimateWidget";
import { DetectedObjectsWidget } from "./widgets/DetectedObjectsWidget";
import type { Widget } from "./widgets/types";

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
  onRefine,
  refining = false,
}: {
  queryImageUrl: string | null;
  queryImageId: string | null;
  onRefine: (regionId: string) => void;
  refining?: boolean;
}) {
  const { queryImageName, candidatesByRegion, selectedRegionId } = useSearchStore();
  const candidates = selectedRegionId ? candidatesByRegion[selectedRegionId] ?? [] : [];
  const [top, ...rest] = candidates;

  const widgets: Widget[] = [
    {
      id: "search-results",
      title: "Resultado",
      icon: SEARCH_ICON,
      colSpan: 2,
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
              onRefine={onRefine}
              refining={refining}
            />
          )}
          <OtherCandidatesList
            candidates={rest}
            queryImageUrl={queryImageUrl}
            onRefine={onRefine}
            refining={refining}
          />
        </>
      ),
    },
    {
      id: "exif",
      title: "Metadatos EXIF",
      icon: SEARCH_ICON,
      colSpan: 1,
      locked: false,
      defaultExpanded: true,
      render: () => (queryImageId ? <ExifMetadataWidget imageId={queryImageId} estimatedTime={null} /> : <div className="text-[9.5px] text-muted">Sin imagen de consulta.</div>),
    },
    {
      id: "estimated-time",
      title: "Hora estimada",
      icon: SEARCH_ICON,
      colSpan: 1,
      locked: true,
      defaultExpanded: false,
      render: () => <EstimatedTimeWidget locked={true} estimatedHour={null} onInstall={noop} />,
    },
    {
      id: "weather",
      title: "Clima estimado",
      icon: SEARCH_ICON,
      colSpan: 1,
      locked: true,
      defaultExpanded: false,
      render: () => <WeatherEstimateWidget onInstall={noop} />,
    },
    {
      id: "detected-objects",
      title: "Objetos detectados",
      icon: SEARCH_ICON,
      colSpan: 1,
      locked: true,
      defaultExpanded: false,
      render: () => <DetectedObjectsWidget onInstall={noop} />,
    },
  ];

  return <WidgetGrid widgets={widgets} />;
}
