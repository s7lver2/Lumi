// apps/web/app/api/models/[modelId]/refine/route.ts
import { RETRIEVAL_MODELS, DEFAULT_CONFIRM_THRESHOLD, type RefineRequest } from "@netryx/shared-types";
import { getPool } from "../../../../../lib/db";
import { getSettingsRepo } from "../../../../../lib/settings-repo";
import { validateModelId } from "../../../../../lib/models/validate-model-id";
import { verifyCandidates } from "../../../../../lib/verify-client";
import { expandRegionCandidates } from "../../../../../lib/search/refine-retrieval";
import { readImageBase64 } from "../../../../../lib/search/candidate-images";
import { persistRefine } from "../../../../../lib/search/refine-persist";
import { runRefine, type RunRefineDeps } from "../../../../../lib/search/run-refine";

export async function POST(request: Request, { params }: { params: { modelId: string } }) {
  let body: RefineRequest;
  let activeModelId: string;
  let confirmThreshold: number;
  try {
    body = (await request.json()) as RefineRequest;
    if (!body.searchId || !body.regionId) {
      return new Response(JSON.stringify({ error: "searchId and regionId are required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const repo = getSettingsRepo();
    activeModelId = (await repo.getSetting("RETRIEVAL_MODEL")) ?? "lumi-preview";
    confirmThreshold = Number(
      (await repo.getSetting("VERIFICATION_CONFIRM_THRESHOLD")) ?? String(DEFAULT_CONFIRM_THRESHOLD)
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Could not read request or settings" }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }

  const check = validateModelId(params.modelId, RETRIEVAL_MODELS.map((m) => m.id), activeModelId);
  if (!check.ok) {
    return new Response(JSON.stringify({ error: check.error }), {
      status: check.status,
      headers: { "content-type": "application/json" },
    });
  }

  const pool = getPool();
  const inferenceBaseUrl = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";

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
          const etaMs = verified > 0 ? Math.round((elapsedMs / verified) * (total - verified)) : null;
          send({ type: "progress", verified, total, elapsedMs, etaMs });
        },
      };

      try {
        const result = await runRefine(deps, { searchId: body.searchId, regionId: body.regionId });
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
