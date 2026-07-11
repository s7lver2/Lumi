// apps/web/app/components/RefinedCandidateCard.tsx
"use client";
import { formatCoords } from "../lib/coords";
import { streetViewMapsUrl } from "../lib/street-view-maps-url";
import { useReverseGeocode } from "../lib/useReverseGeocode";
import type { SearchCandidate } from "@netryx/shared-types";

export function RefinedCandidateCard({
  searchId,
  candidate,
}: {
  searchId: string;
  candidate: SearchCandidate;
}) {
  const place = useReverseGeocode(candidate.lat, candidate.lng);
  const pct = Math.round((candidate.verificationScore ?? 0) * 100);

  return (
    <div className="rounded-card border border-accent-fg/30 bg-white/[.04] p-3">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-accent-fg text-[10px] font-medium text-accent-fg">
          {pct}%
        </div>
        <div>
          <div className="text-sm text-fg">{place ?? "Localizando…"}</div>
          <div className="text-[11px] text-accent-fg">confirmado · verificación geométrica</div>
        </div>
      </div>

      <div className="mt-3 flex gap-1.5">
        <div className="min-w-0 flex-1">
          <img
            src={`/api/images/query/${searchId}`}
            alt="Tu foto"
            className="aspect-[4/3] w-full rounded-md border border-border object-cover"
          />
          <div className="mt-1 text-[10px] text-subtle">Tu foto</div>
        </div>
        <div className="min-w-0 flex-1">
          <img
            src={`/api/images/indexed/${candidate.indexedImageId}`}
            alt="Street View"
            className="aspect-[4/3] w-full rounded-md border border-accent-fg/40 object-cover"
          />
          <div className="mt-1 text-[10px] text-accent-fg">Street View</div>
        </div>
      </div>

      <a
        href={streetViewMapsUrl(candidate.panoId, candidate.heading)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 flex items-center justify-between rounded-md bg-white/[.04] px-2.5 py-2 font-mono text-xs text-fg hover:bg-white/10"
        title="Abrir en Google Maps (Street View, mismo ángulo de la foto)"
      >
        {formatCoords(candidate.lat, candidate.lng)}
      </a>
    </div>
  );
}
