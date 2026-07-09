// apps/web/app/components/TopResultCard.tsx
"use client";

import { FloatingCard } from "./FloatingCard";
import { RingGauge } from "./RingGauge";
import { useSearchStore } from "../stores/useSearchStore";
import { useReverseGeocode } from "../lib/useReverseGeocode";

export function TopResultCard({ onRefine }: { onRefine: (regionId: string) => void }) {
  const { regions, selectedRegionId, candidatesByRegion } = useSearchStore();
  const region = regions.find((r) => r.id === selectedRegionId) ?? regions[0];
  const top = region ? candidatesByRegion[region.id]?.[0] : undefined;
  const place = useReverseGeocode(region?.centroid.lat ?? 0, region?.centroid.lng ?? 0);
  if (!region) return null;

  const pct = Math.round(region.aggregateScore * 100);
  return (
    <div className="absolute left-1/2 top-4 w-96 -translate-x-1/2">
      <FloatingCard className="p-4">
        <div className="flex items-center gap-2">
          <RingGauge value={region.aggregateScore} size={28} />
          <span className="text-sm font-medium text-fg">{pct}% · Resultado principal</span>
        </div>
        <ul className="mt-3 space-y-1 text-xs text-muted">
          <li>Posible ubicación: <span className="text-fg">{place ?? "…"}</span>.</li>
          <li className="text-accent-fg">{region.candidateCount} de los resultados caen en esta región.</li>
          <li>Radio aproximado: {(region.radiusM / 1000).toFixed(1)} km.</li>
        </ul>
        {top && (
          <button
            onClick={() => onRefine(region.id)}
            className="mt-3 w-full rounded-md bg-elevated py-2 text-xs font-medium text-fg hover:bg-white/10"
          >
            Refinar en {place ?? "esta región"}
          </button>
        )}
      </FloatingCard>
    </div>
  );
}