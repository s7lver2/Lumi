// apps/web/app/components/BottomSummaryBar.tsx
"use client";

import { useSearchStore } from "../stores/useSearchStore";
import { useReverseGeocode } from "../lib/useReverseGeocode";
import { formatCoords } from "../lib/coords";

export function BottomSummaryBar() {
  const { regions, selectedRegionId, candidatesByRegion } = useSearchStore();
  const region = regions.find((r) => r.id === selectedRegionId) ?? regions[0];
  const top = region ? candidatesByRegion[region.id]?.[0] : undefined;
  const place = useReverseGeocode(region?.centroid.lat ?? 0, region?.centroid.lng ?? 0);
  if (!region) return null;

  const confirmed = top?.status === "confirmed";
  const pct = Math.round((top?.verificationScore ?? region.aggregateScore) * 100);
  return (
    <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between border-t border-border bg-panel/80 px-6 py-3 backdrop-blur-md">
      <div className="flex gap-10">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-subtle">Identificado</div>
          <div className="mt-0.5 text-sm text-fg">{place ?? "—"}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-subtle">Coordenadas</div>
          <div className="mt-0.5 font-mono text-sm text-fg">
            {region ? formatCoords(region.centroid.lat, region.centroid.lng) : "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-subtle">Radio</div>
          <div className="mt-0.5 text-sm text-fg">~{(region.radiusM / 1000).toFixed(1)} km</div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-2xl font-medium text-accent-fg">{pct}%</div>
        <div className="text-[10px] uppercase tracking-wider text-subtle">
          {confirmed ? "confirmado" : "coincidencia"}
        </div>
      </div>
    </div>
  );
}