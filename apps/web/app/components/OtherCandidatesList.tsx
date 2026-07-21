// apps/web/app/components/OtherCandidatesList.tsx
"use client";
import { useEffect, useState } from "react";
import { RingGauge } from "./RingGauge";
import { Badge } from "./Badge";
import { CandidateComparisonCard } from "./CandidateComparisonCard";
import type { SearchCandidate } from "@netryx/shared-types";

const PAGE_SIZE = 6;

export function OtherCandidatesList({
  candidates,
  queryImageUrl,
  onRefineCandidate,
  refining,
}: {
  candidates: SearchCandidate[];
  queryImageUrl: string | null;
  onRefineCandidate: (candidateId: string, regionId: string) => void;
  refining: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(candidates.length / PAGE_SIZE));

  useEffect(() => {
    setPage(0);
    setExpandedId(null);
  }, [candidates]);

  if (candidates.length === 0) return null;

  const start = page * PAGE_SIZE;
  const pageItems = candidates.slice(start, start + PAGE_SIZE);

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[10.5px] uppercase tracking-wide text-subtle">
          Otros ángulos en esta zona · {candidates.length}
        </span>
        {pageCount > 1 && (
          <span className="text-[10px] text-subtle">
            {start + 1}–{Math.min(start + PAGE_SIZE, candidates.length)} de {candidates.length}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-col gap-1.5">
        {pageItems.map((c) => {
          const isExpanded = expandedId === c.id;
          const score = c.verificationScore ?? c.similarityScore;
          return isExpanded ? (
            <div key={c.id} onClick={() => setExpandedId(null)} className="cursor-pointer">
              <CandidateComparisonCard
                candidate={c}
                queryImageUrl={queryImageUrl}
                showZoneRefine={false}
                onRefineCandidate={onRefineCandidate}
                refining={refining}
              />
            </div>
          ) : (
            <div
              key={c.id}
              onClick={() => setExpandedId(c.id)}
              className="flex cursor-pointer items-center gap-2.5 rounded-card border border-border p-2.5 transition-colors hover:border-white/20 hover:bg-white/[.03]"
            >
              <img
                src={`/api/images/indexed/${c.indexedImageId}`}
                alt=""
                className="h-11 w-11 shrink-0 rounded-md object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <RingGauge value={score} size={16} tone={c.status === "confirmed" ? "accent" : "muted"} />
                  <Badge tone={c.status === "confirmed" ? "accent" : "muted"}>
                    {c.status === "confirmed" ? "confirmado" : "sin verificar"}
                  </Badge>
                </div>
                <span className="truncate text-[12.5px] text-fg">
                  {Math.round(score * 100)}% {c.verificationScore != null ? "verificación" : "similitud"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {pageCount > 1 && (
        <div className="mt-2.5 flex items-center justify-center gap-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPage((p) => Math.max(0, p - 1));
            }}
            disabled={page === 0}
            className="rounded-md px-2 py-1 text-[11px] text-muted hover:text-fg disabled:opacity-30 disabled:hover:text-muted"
          >
            ← Anterior
          </button>
          <span className="text-[10.5px] text-subtle">
            Página {page + 1} de {pageCount}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPage((p) => Math.min(pageCount - 1, p + 1));
            }}
            disabled={page >= pageCount - 1}
            className="rounded-md px-2 py-1 text-[11px] text-muted hover:text-fg disabled:opacity-30 disabled:hover:text-muted"
          >
            Siguiente →
          </button>
        </div>
      )}
    </div>
  );
}
