// apps/web/app/components/ResultsPanel.tsx
"use client";

import { useSearchStore } from "../stores/useSearchStore";
import { RingGauge } from "./RingGauge";
import { Badge } from "./Badge";
import { formatCoords } from "../lib/coords";
import { useReverseGeocode } from "../lib/useReverseGeocode";
import { streetViewMapsUrl } from "../lib/street-view-maps-url";
import { RefinedCandidateCard } from "./RefinedCandidateCard";
import type { SearchCandidate } from "@netryx/shared-types";

function ResultRow({
  c,
  onRefine,
  onSelectRegion,
  refining,
}: {
  c: SearchCandidate;
  onRefine: (regionId: string) => void;
  onSelectRegion?: (regionId: string) => void;
  refining: boolean;
}) {
  const place = useReverseGeocode(c.lat, c.lng);
  const score = c.verificationScore ?? c.similarityScore;
  const selected = useSearchStore((s) => s.selectedRegionId) === c.regionId;

  return (
    <div
      role={c.regionId ? "button" : undefined}
      tabIndex={c.regionId ? 0 : undefined}
      onClick={() => c.regionId && onSelectRegion?.(c.regionId)}
      className={`rounded-card border p-3 ${c.regionId ? "cursor-pointer" : ""} ${
        selected ? "border-accent-fg/40 bg-white/5" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex gap-2">
          <span className="text-xs text-subtle">{c.rank}</span>
          <div>
            <div className="text-sm text-fg">{place ?? "Localizando…"}</div>
            <div className="mt-1 flex items-center gap-1.5">
              <RingGauge value={score} tone={c.status === "confirmed" ? "accent" : "muted"} />
              <span className="text-xs text-muted">
                {Math.round((c.verificationScore ?? c.similarityScore) * 100)}%{" "}
                {c.verificationScore != null ? "verificación" : "similitud"}
              </span>
            </div>
          </div>
        </div>
        <Badge tone={c.status === "confirmed" ? "accent" : "muted"}>{c.status}</Badge>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <a
          href={streetViewMapsUrl(c.panoId, c.heading)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-xs text-muted hover:text-fg hover:underline"
          title="Abrir en Google Maps (Street View, mismo ángulo de la foto)"
        >
          {formatCoords(c.lat, c.lng)}
        </a>
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(formatCoords(c.lat, c.lng));
          }}
          className="text-subtle hover:text-fg"
          title="Copiar coordenadas"
          aria-label="Copiar coordenadas"
        >
          ⧉
        </button>
      </div>
      {c.regionId && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRefine(c.regionId!);
          }}
          disabled={refining}
          className="mt-2 text-xs text-draw-fg hover:underline disabled:opacity-50 disabled:no-underline"
        >
          {refining && selected ? "Refinando…" : selected ? "Refinar aquí" : "Precisión de calle disponible"}
        </button>
      )}
    </div>
  );
}

export function ResultsPanel({
  queryImageUrl,
  onRefine,
  onSelectRegion,
  refining = false,
}: {
  queryImageUrl: string | null;
  onRefine: (regionId: string) => void;
  onSelectRegion?: (regionId: string) => void;
  refining?: boolean;
}) {
  const { queryImageName, regions, candidatesByRegion, currentSearchId, selectedRegionId } = useSearchStore();
  const all = regions.flatMap((r) => candidatesByRegion[r.id] ?? []);
  const confirmed = selectedRegionId
    ? candidatesByRegion[selectedRegionId]?.find((c) => c.status === "confirmed")
    : undefined;

  return (
    <div className="flex h-full w-80 flex-col border-l border-border bg-panel/80 backdrop-blur-md">
      <div className="flex items-center gap-3 border-b border-border p-4">
        {queryImageUrl && <img src={queryImageUrl} alt="" className="h-14 w-14 rounded-md object-cover" />}
        <span className="truncate font-mono text-xs text-muted">{queryImageName}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {confirmed && currentSearchId && (
          <RefinedCandidateCard searchId={currentSearchId} candidate={confirmed} />
        )}
        <div className="text-xs text-muted">
          {all.length} candidatos{all.every((c) => c.status !== "confirmed") ? " (sin verificar)" : ""}
        </div>
        {all.map((c) => (
          <ResultRow
            key={c.id}
            c={c}
            onRefine={onRefine}
            onSelectRegion={onSelectRegion}
            refining={refining}
          />
        ))}
      </div>
    </div>
  );
}
