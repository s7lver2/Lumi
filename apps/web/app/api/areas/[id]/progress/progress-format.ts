// apps/web/app/api/areas/[id]/progress/progress-format.ts
//
// Pure formatting / polling-decision helpers for the SSE progress endpoint.
// These live outside route.ts on purpose: Next.js App Router route modules may
// only export HTTP method handlers (GET, POST, ...) plus a fixed set of config
// names, so `next build`'s type check rejects any other export from route.ts.
// Keeping the tested pure logic here satisfies that constraint (spec §6.2).
import type { AreaStatus } from "@netryx/shared-types";

export interface AreaProgressRow {
  status: AreaStatus;
  points_estimated: number;
  points_captured: number;
  points_failed: number;
  images_embedded: number;
}

export function isTerminalStatus(status: AreaStatus): boolean {
  return status === "indexed" || status === "failed" || status === "cancelled";
}

export function formatProgressEvent(row: AreaProgressRow): string {
  const payload = {
    status: row.status,
    pointsEstimated: row.points_estimated,
    pointsCaptured: row.points_captured,
    pointsFailed: row.points_failed,
    imagesEmbedded: row.images_embedded,
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}
