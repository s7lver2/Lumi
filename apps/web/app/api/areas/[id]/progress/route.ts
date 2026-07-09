// apps/web/app/api/areas/[id]/progress/route.ts
import type { AreaStatus } from "@netryx/shared-types";
import { getPool } from "../../../../../lib/db";

interface AreaProgressRow {
  status: AreaStatus;
  points_estimated: number;
  points_captured: number;
  points_failed: number;
  images_embedded: number;
}

export function isTerminalStatus(status: AreaStatus): boolean {
  return status === "indexed" || status === "failed";
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

const POLL_INTERVAL_MS = 1000;

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const pool = getPool();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      while (true) {
        const { rows } = await pool.query<AreaProgressRow>(
          `SELECT status, points_estimated, points_captured, points_failed, images_embedded
           FROM areas WHERE id = $1`,
          [params.id]
        );

        if (rows.length === 0) {
          controller.enqueue(encoder.encode(`event: error\ndata: area not found\n\n`));
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(formatProgressEvent(rows[0])));

        if (isTerminalStatus(rows[0].status)) {
          controller.close();
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}