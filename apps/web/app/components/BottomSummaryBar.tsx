// apps/web/app/components/BottomSummaryBar.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchStore } from "../stores/useSearchStore";
import { useReverseGeocode } from "../lib/useReverseGeocode";
import { formatCoords } from "../lib/coords";
import { streetViewMapsUrl } from "../lib/street-view-maps-url";

export function BottomSummaryBar({
  onRefine,
  refining,
}: {
  onRefine: (regionId: string) => void;
  refining: boolean;
}) {
  const { regions, selectedRegionId, candidatesByRegion } = useSearchStore();
  const region = regions.find((r) => r.id === selectedRegionId) ?? regions[0];
  const top = region ? candidatesByRegion[region.id]?.[0] : undefined;
  const place = useReverseGeocode(region?.centroid.lat ?? 0, region?.centroid.lng ?? 0);

  // Scroll events on descendant elements (e.g. the widget sidebar's own
  // scroll container) don't bubble, but a capture-phase listener on window
  // still sees them on the way down — lets this bar react to scrolling
  // anywhere on the page without the scrollable element needing to know
  // about it.
  const [hidden, setHidden] = useState(false);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    function handleScroll() {
      setHidden(true);
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
      hideTimeout.current = setTimeout(() => setHidden(false), 500);
    }
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
    };
  }, []);

  if (!region) return null;

  const confirmed = top?.status === "confirmed";
  const pct = Math.round((top?.verificationScore ?? region.aggregateScore) * 100);
  return (
    <div
      className={`absolute bottom-0 left-0 right-[520px] flex items-center justify-between border-t border-border bg-panel/80 px-4 py-2 backdrop-blur-md transition-all duration-300 ease-out ${
        hidden ? "pointer-events-none translate-y-2 opacity-0" : "translate-y-0 opacity-100"
      }`}
    >
      <div className="flex items-center gap-6">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-subtle">Identificado</div>
          <div className="text-xs text-fg">{place ?? "—"}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider text-subtle">Coordenadas</div>
          {top ? (
            <a
              href={streetViewMapsUrl(top.panoId, top.heading)}
              target="_blank"
              rel="noopener noreferrer"
              className="block font-mono text-xs text-fg hover:underline"
              title="Abrir en Google Maps (Street View, mismo ángulo de la foto)"
            >
              {formatCoords(top.lat, top.lng)}
            </a>
          ) : (
            <div className="font-mono text-xs text-fg">
              {region ? formatCoords(region.centroid.lat, region.centroid.lng) : "—"}
            </div>
          )}
        </div>
        <div>
          {/* radiusM is the fixed clustering-bucket radius (DEFAULT_REGION_RADIUS_M),
              the same value for every region regardless of how tightly its
              candidates actually agree — NOT a computed confidence interval. */}
          <div className="text-[9px] uppercase tracking-wider text-subtle">Radio de búsqueda</div>
          <div className="text-xs text-fg">~{(region.radiusM / 1000).toFixed(2)} km</div>
        </div>
        <button
          onClick={() => onRefine(region.id)}
          disabled={refining}
          className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-black disabled:opacity-50"
        >
          {refining ? "Refinando…" : "Refinar toda esta zona"}
        </button>
      </div>
      <div className="text-right">
        <div className="text-lg font-medium text-accent-fg">{pct}%</div>
        <div className="text-[9px] uppercase tracking-wider text-subtle">
          {confirmed ? "confirmado" : "coincidencia"}
        </div>
      </div>
    </div>
  );
}
