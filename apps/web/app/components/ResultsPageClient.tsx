// apps/web/app/components/ResultsPageClient.tsx
"use client";
import { useEffect, useState } from "react";
import type { SearchResponse } from "@netryx/shared-types";
import { RETRIEVAL_MODELS } from "@netryx/shared-types";
import { AppShell } from "./AppShell";
import { MapCanvas } from "./MapCanvas";
import { ConfidenceCircleLayer } from "./ConfidenceCircleLayer";
import { ResultsPanel } from "./ResultsPanel";
import { useSearchStore } from "../stores/useSearchStore";

const activeModelId = RETRIEVAL_MODELS[0]?.id ?? "lumi-preview";

export function ResultsPageClient({ initialResult, searchId }: { initialResult: SearchResponse; searchId: string }) {
  const [map, setMap] = useState<any>(null);
  const { regions, setSearchResults, setRefining, setRefineResults, selectRegion } = useSearchStore();
  const [refining, setRefiningLocal] = useState(false);

  useEffect(() => {
    setSearchResults(initialResult, searchId);
    // For any region whose top candidate already carries a
    // verificationScore, seed candidatesByRegion as-is — setSearchResults
    // already copies candidatesByRegion verbatim, so refined data loaded
    // from the DB shows immediately without needing a live refine call.
  }, [initialResult, searchId, setSearchResults]);

  async function handleRefine(regionId: string) {
    selectRegion(regionId);
    setRefining();
    setRefiningLocal(true);

    const res = await fetch(`/api/models/${activeModelId}/refine`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ searchId, regionId }),
    });
    if (!res.ok || !res.body) {
      setRefiningLocal(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const raw = part.replace(/^data: /, "");
        if (!raw) continue;
        const event = JSON.parse(raw);
        if (event.type === "done") setRefineResults(regionId, event.result.candidates);
      }
    }
    setRefiningLocal(false);
  }

  return (
    <AppShell>
      <MapCanvas onReady={(m) => setMap(m)} />
      {map && <ConfidenceCircleLayer map={map} />}
      {regions.length > 0 && (
        <div className="absolute right-0 top-0 h-full w-[520px]">
          <ResultsPanel
            queryImageUrl={`/api/images/query/${searchId}`}
            queryImageId={null}
            onRefine={handleRefine}
            refining={refining}
          />
        </div>
      )}
    </AppShell>
  );
}
