// apps/web/app/api/search/[searchId]/refine/route.ts
import { DEFAULT_CONFIRM_THRESHOLD, type RefineRequest } from "@netryx/shared-types";
import { getPool } from "../../../../../lib/db";
import { getSettingsRepo } from "../../../../../lib/settings-repo";
import { verifyCandidates } from "../../../../../lib/verify-client";
import { expandRegionCandidates } from "../../../../../lib/search/refine-retrieval";
import { readImageBase64 } from "../../../../../lib/search/candidate-images";
import { persistRefine } from "../../../../../lib/search/refine-persist";
import { runRefine, type RunRefineDeps } from "../../../../../lib/search/run-refine";

// Streamed as Server-Sent Events, not a single JSON response — RoMa/Laila
// verification is ~10-25s PER CANDIDATE (see run-refine.ts's VERIFY_CHUNK_SIZE
// comment), so a region with 8+ candidates used to mean one blocking request
// running for minutes with zero feedback. Mirrors the setup wizard's
// /api/setup/run/[step] SSE pattern (progress lines + a final "done" event).
export async function POST(
  request: Request,
  { params }: { params: { searchId: string } }
) {
  const body = (await request.json()) as RefineRequest;
  if (!body.regionId) {
    return new Response(JSON.stringify({ error: "regionId is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const pool = getPool();
  const repo = getSettingsRepo();
  const inferenceBaseUrl = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";
  const confirmThreshold = Number(
    (await repo.getSetting("VERIFICATION_CONFIRM_THRESHOLD")) ?? String(DEFAULT_CONFIRM_THRESHOLD)
  );

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (e: object) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      const startedAt = Date.now();

      const deps: RunRefineDeps = {
        confirmThreshold,
        getQueryImagePath: async (searchId) => {
          const { rows } = await pool.query(
            `SELECT query_image_path FROM searches WHERE id = $1`,
            [searchId]
          );
          if (rows.length === 0) throw new Error(`Search ${searchId} not found`);
          return rows[0].query_image_path as string;
        },
        expandRegion: (regionId) => expandRegionCandidates(pool, regionId),
        readImage: (path) => readImageBase64(path),
        verify: (q, cands) => verifyCandidates(q, cands, inferenceBaseUrl),
        persist: (args) => persistRefine(pool, args),
        onProgress: (verified, total) => {
          const elapsedMs = Date.now() - startedAt;
          // ETA from the observed average so far — RoMa's first candidate(s)
          // after a cold start pay a one-time CUDA warmup cost (see
          // services/inference/main.py's startup warmup), so this only gets
          // accurate after a couple of candidates, not from candidate 1.
          const etaMs =
            verified > 0 ? Math.round((elapsedMs / verified) * (total - verified)) : null;
          send({ type: "progress", verified, total, elapsedMs, etaMs });
        },
      };

      try {
        const result = await runRefine(deps, { searchId: params.searchId, regionId: body.regionId });
        send({ type: "done", result });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
  });
}