// apps/web/app/lib/useAreaProgress.ts
"use client";

import { useEffect } from "react";
import { useIndexingStore } from "../stores/useIndexingStore";
import { parseProgressData, isTerminal } from "./progress-stream";

/** Subscribes to the SSE progress stream for an area and pushes into the store. */
export function useAreaProgress(areaId: string | null): void {
  const updateProgress = useIndexingStore((s) => s.updateProgress);

  useEffect(() => {
    if (!areaId) return;
    const es = new EventSource(`/api/areas/${areaId}/progress`);
    es.onmessage = (e) => {
      const progress = parseProgressData(e.data);
      updateProgress(progress);
      if (isTerminal(progress.status)) es.close();
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [areaId, updateProgress]);
}