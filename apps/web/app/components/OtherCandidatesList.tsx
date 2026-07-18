// apps/web/app/components/OtherCandidatesList.tsx
"use client";
import { useState } from "react";
import { RingGauge } from "./RingGauge";
import { Badge } from "./Badge";
import { CandidateComparisonCard } from "./CandidateComparisonCard";
import type { SearchCandidate } from "@netryx/shared-types";

export function OtherCandidatesList({
  candidates,
  queryImageUrl,
  onRefine,
  refining,
}: {
  candidates: SearchCandidate[];
  queryImageUrl: string | null;
  onRefine: (regionId: string) => void;
  refining: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (candidates.length === 0) return null;

  return (
    <div className="mt-4">
      <div className="px-0.5 text-[10.5px] uppercase tracking-wide text-subtle">
        Otros ángulos en esta zona · {candidates.length}
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {candidates.map((c) => {
          const isExpanded = expandedId === c.id;
          const score = c.verificationScore ?? c.similarityScore;
          return isExpanded ? (
            <div key={c.id} onClick={() => setExpandedId(null)} className="cursor-pointer">
              <CandidateComparisonCard
                candidate={c}
                queryImageUrl={queryImageUrl}
                onRefine={onRefine}
                refining={refining}
              />
            </div>
          ) : (
            <div
              key={c.id}
              onClick={() => setExpandedId(c.id)}
              className="flex cursor-pointer items-center justify-between rounded-card border border-border p-2.5"
            >
              <div className="flex items-center gap-2">
                <RingGauge value={score} size={16} tone={c.status === "confirmed" ? "accent" : "muted"} />
                <span className="text-[12.5px] text-fg">
                  {Math.round(score * 100)}% {c.verificationScore != null ? "verificación" : "similitud"}
                </span>
              </div>
              <Badge tone={c.status === "confirmed" ? "accent" : "muted"}>
                {c.status === "confirmed" ? "confirmado" : "sin revisar"}
              </Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}
