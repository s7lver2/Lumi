// apps/web/app/components/TopResultCard.tsx
"use client";

import { FloatingCard } from "./FloatingCard";
import { RingGauge } from "./RingGauge";
import { ModelLoadingNotice } from "./ModelLoadingNotice";
import { useSearchStore } from "../stores/useSearchStore";
import { useReverseGeocode } from "../lib/useReverseGeocode";

export function TopResultCard({
  onRefine,
  onSelectRegion,
  refining = false,
}: {
  onRefine: (regionId: string) => void;
  onSelectRegion?: (regionId: string) => void;
  refining?: boolean;
}) {
  const { regions, selectedRegionId, candidatesByRegion } = useSearchStore();
  const region = regions.find((r) => r.id === selectedRegionId) ?? regions[0];
  const top = region ? candidatesByRegion[region.id]?.[0] : undefined;
  const place = useReverseGeocode(region?.centroid.lat ?? 0, region?.centroid.lng ?? 0);
  if (!region) return null;

  const pct = Math.round(region.aggregateScore * 100);

  return (
    <div
      className="absolute left-1/2 top-4 w-96 -translate-x-1/2 cursor-pointer"
      onClick={() => onSelectRegion?.(region.id)}
    >
      <FloatingCard className="p-4">
        <div className="flex items-center gap-2">
          <RingGauge value={region.aggregateScore} size={28} />
          <span className="text-sm font-medium text-fg">{pct}% · Resultado principal</span>
        </div>
        <ul className="mt-3 space-y-1 text-xs text-muted">
          <li>Posible ubicación: <span className="text-fg">{place ?? "…"}</span>.</li>
          <li className="text-accent-fg">{region.candidateCount} de los resultados caen en esta región.</li>
          {/* radiusM is the fixed clustering-bucket radius (DEFAULT_REGION_RADIUS_M),
              the same value for every region regardless of how tightly its
              candidates actually agree — NOT a computed confidence interval.
              Worded as "search radius" so it doesn't read as false precision. */}
          <li>Radio de búsqueda: {(region.radiusM / 1000).toFixed(2)} km.</li>
        </ul>
        {top && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRefine(region.id);
            }}
            disabled={refining}
            className="mt-3 w-full rounded-md bg-elevated py-2 text-xs font-medium text-fg hover:bg-white/10 disabled:opacity-50"
          >
            {refining ? "Refinando…" : `Refinar en ${place ?? "esta región"}`}
          </button>
        )}
        <ModelLoadingNotice active={refining} />
      </FloatingCard>
    </div>
  );
}
