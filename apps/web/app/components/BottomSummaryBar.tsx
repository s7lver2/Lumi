// apps/web/app/components/BottomSummaryBar.tsx
"use client";

import { useSearchStore } from "../stores/useSearchStore";
import { useReverseGeocode } from "../lib/useReverseGeocode";
import { formatCoords } from "../lib/coords";
import { streetViewMapsUrl } from "../lib/street-view-maps-url";

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
          {top ? (
            <a
              href={streetViewMapsUrl(top.panoId, top.heading)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block font-mono text-sm text-fg hover:underline"
              title="Abrir en Google Maps (Street View, mismo ángulo de la foto)"
            >
              {formatCoords(top.lat, top.lng)}
            </a>
          ) : (
            <div className="mt-0.5 font-mono text-sm text-fg">
              {region ? formatCoords(region.centroid.lat, region.centroid.lng) : "—"}
            </div>
          )}
        </div>
        <div>
          {/* radiusM is the fixed clustering-bucket radius (DEFAULT_REGION_RADIUS_M),
              the same value for every region regardless of how tightly its
              candidates actually agree — NOT a computed confidence interval. */}
          <div className="text-[10px] uppercase tracking-wider text-subtle">Radio de búsqueda</div>
          <div className="mt-0.5 text-sm text-fg">~{(region.radiusM / 1000).toFixed(2)} km</div>
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