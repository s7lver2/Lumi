// apps/web/app/api/models/[modelId]/estimate/route.ts
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  RETRIEVAL_MODELS,
  DEFAULT_TOP_K,
  DEFAULT_REGION_RADIUS_M,
  DEFAULT_QUERY_EXPANSION_SIZE,
} from "@netryx/shared-types";
import { getPool } from "../../../../../lib/db";
import { getSettingsRepo } from "../../../../../lib/settings-repo";
import { validateModelId } from "../../../../../lib/models/validate-model-id";
import { saveQueryImage } from "../../../../../lib/query-image-store";
import { embedQueryImage } from "../../../../../lib/inference-client";
import { retrieveCandidates } from "../../../../../lib/search/retrieval";
import { queryExpansionRerank } from "../../../../../lib/search/rerank";
import { clusterCandidates } from "../../../../../lib/search/cluster";
import { persistSearch } from "../../../../../lib/search/persist";
import { runSearch, type RunSearchDeps } from "../../../../../lib/search/run-search";

function extFromType(type: string): string {
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  return "jpg";
}

export async function POST(request: Request, { params }: { params: { modelId: string } }) {
  const activeModelId = (await getSettingsRepo().getSetting("RETRIEVAL_MODEL")) ?? "lumi-preview";
  const check = validateModelId(params.modelId, RETRIEVAL_MODELS.map((m) => m.id), activeModelId);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Request must be multipart/form-data with an \"image\" field" },
      { status: 400 }
    );
  }

  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "image file is required" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const imageBase64 = bytes.toString("base64");
  const imageExt = extFromType(file.type);

  const pool = getPool();
  const inferenceBaseUrl = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";

  const deps: RunSearchDeps = {
    newSearchId: () => randomUUID(),
    embedQuery: (b64) => embedQueryImage(b64, inferenceBaseUrl),
    retrieve: (embedding) => retrieveCandidates(pool, embedding, DEFAULT_TOP_K),
    rerank: (embedding, candidates) =>
      queryExpansionRerank(embedding, candidates, DEFAULT_QUERY_EXPANSION_SIZE),
    cluster: (candidates) => clusterCandidates(candidates, DEFAULT_REGION_RADIUS_M),
    saveImage: (searchId, b, ext) => saveQueryImage(searchId, b, ext),
    persist: (args) => persistSearch(pool, args),
  };

  try {
    const result = await runSearch(deps, { imageBase64, imageBytes: bytes, imageExt });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search failed" },
      { status: 502 }
    );
  }
}
