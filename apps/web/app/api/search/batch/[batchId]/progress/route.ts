import { getPool } from "../../../../../../lib/db";

const POLL_INTERVAL_MS = 1000;

interface SearchBatchProgressRow {
  status: "pending" | "running" | "done" | "failed";
  total: number;
  done: number;
  failed: number;
}

function isTerminal(status: string): boolean {
  return status === "done" || status === "failed";
}

export async function GET(_request: Request, { params }: { params: { batchId: string } }) {
  const pool = getPool();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      while (true) {
        const { rows } = await pool.query<SearchBatchProgressRow>(
          "SELECT status, total, done, failed FROM search_batches WHERE id = $1",
          [params.batchId]
        );

        if (rows.length === 0) {
          controller.enqueue(encoder.encode(`event: error\ndata: batch not found\n\n`));
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify(rows[0])}\n\n`));

        if (isTerminal(rows[0].status)) {
          controller.close();
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
  });
}