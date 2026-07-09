// apps/web/app/components/ResultsPanel.tsx
"use client";

import { useSearchStore } from "../stores/useSearchStore";
import { RingGauge } from "./RingGauge";
import { Badge } from "./Badge";
import { formatCoords } from "../lib/coords";
import { useReverseGeocode } from "../lib/useReverseGeocode";
import type { SearchCandidate } from "@netryx/shared-types";

function ResultRow({ c, onRefine }: { c: SearchCandidate; onRefine: (regionId: string) => void }) {
  const place = useReverseGeocode(c.lat, c.lng);
  const score = c.verificationScore ?? c.similarityScore;
  const selected = useSearchStore((s) => s.selectedRegionId) === c.regionId;
  return (
    <div className={`rounded-card border p-3 ${selected ? "border-accent-fg/40 bg-white/5" : "border-border"}`}>
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
      <button
        onClick={() => navigator.clipboard.writeText(formatCoords(c.lat, c.lng))}
        className="mt-2 flex items-center gap-1 font-mono text-xs text-muted hover:text-fg"
        title="Copiar coordenadas"
      >
        {formatCoords(c.lat, c.lng)}
      </button>
      {c.regionId && (
        <button
          onClick={() => onRefine(c.regionId!)}
          className="mt-2 text-xs text-draw-fg hover:underline"
        >
          {selected ? "Refinar aquí" : "Precisión de calle disponible"}
        </button>
      )}
    </div>
  );
}

export function ResultsPanel({
  queryImageUrl,
  onRefine,
}: {
  queryImageUrl: string | null;
  onRefine: (regionId: string) => void;
}) {
  const { queryImageName, regions, candidatesByRegion } = useSearchStore();
  const all = regions.flatMap((r) => candidatesByRegion[r.id] ?? []);

  return (
    <div className="flex h-full w-80 flex-col border-l border-border bg-panel/80 backdrop-blur-md">
      <div className="flex items-center gap-3 border-b border-border p-4">
        {queryImageUrl && <img src={queryImageUrl} alt="" className="h-14 w-14 rounded-md object-cover" />}
        <span className="truncate font-mono text-xs text-muted">{queryImageName}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        <div className="text-xs text-muted">{all.length} resultados</div>
        {all.map((c) => (
          <ResultRow key={c.id} c={c} onRefine={onRefine} />
        ))}
      </div>
    </div>
  );
}