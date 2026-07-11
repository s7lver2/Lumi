// apps/web/app/lib/progress-stream.ts
import type { AreaStatus } from "@netryx/shared-types";
import type { JobProgress } from "../stores/useIndexingStore";

export function isTerminal(status: AreaStatus): boolean {
  return status === "indexed" || status === "failed" || status === "cancelled";
}

export function parseProgressData(json: string): JobProgress {
  const p = JSON.parse(json) as JobProgress;
  return {
    status: p.status,
    pointsEstimated: p.pointsEstimated,
    pointsCaptured: p.pointsCaptured,
    pointsFailed: p.pointsFailed,
    imagesEmbedded: p.imagesEmbedded,
  };
}