"use client";
import { RingGauge } from "./RingGauge";
import { Badge } from "./Badge";
import { PhotoComparison } from "./PhotoComparison";
import { formatCoords } from "../lib/coords";
import { streetViewMapsUrl } from "../lib/street-view-maps-url";
import { useReverseGeocode } from "../lib/useReverseGeocode";
import type { SearchCandidate } from "@netryx/shared-types";

export function CandidateComparisonCard({
  candidate,
  queryImageUrl,
  onRefine,
  refining,
}: {
  candidate: SearchCandidate;
  queryImageUrl: string | null;
  onRefine: (regionId: string) => void;
  refining: boolean;
}) {
  const place = useReverseGeocode(candidate.lat, candidate.lng);
  const verified = candidate.verificationScore != null;
  const score = candidate.verificationScore ?? candidate.similarityScore;

  return (
    <div className="rounded-card border border-border bg-elevated p-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <RingGauge value={score} tone={candidate.status === "confirmed" ? "accent" : "muted"} />
          <div>
            <div className="text-sm text-fg">{place ?? "Localizando…"}</div>
            <div className="text-[11px] text-muted">
              {Math.round(score * 100)}% {verified ? "verificación" : "similitud"}
            </div>
          </div>
        </div>
        <Badge tone={candidate.status === "confirmed" ? "accent" : "muted"}>
          {candidate.status === "confirmed" ? "confirmado" : "sin verificar"}
        </Badge>
      </div>

      {queryImageUrl && (
        <PhotoComparison
          queryImageUrl={queryImageUrl}
          candidateImageUrl={`/api/images/indexed/${candidate.indexedImageId}`}
        />
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <a
          href={streetViewMapsUrl(candidate.panoId, candidate.heading)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-xs text-muted hover:text-fg hover:underline"
          title="Abrir en Google Maps (Street View, mismo ángulo de la foto)"
        >
          {formatCoords(candidate.lat, candidate.lng)}
        </a>
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(formatCoords(candidate.lat, candidate.lng));
          }}
          className="text-subtle hover:text-fg"
          title="Copiar coordenadas"
          aria-label="Copiar coordenadas"
        >
          ⧉
        </button>
      </div>

      {candidate.regionId && !verified && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRefine(candidate.regionId!);
          }}
          disabled={refining}
          className="mt-2 w-full rounded-md bg-accent py-2 text-xs font-medium text-black disabled:opacity-50"
        >
          {refining ? "Refinando…" : "Refinar aquí"}
        </button>
      )}
    </div>
  );
}
