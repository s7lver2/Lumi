// apps/web/app/api/models/[modelId]/estimate/route.ts
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  RETRIEVAL_MODELS,
  DEFAULT_TOP_K,
  DEFAULT_REGION_RADIUS_M,
  DEFAULT_QUERY_EXPANSION_SIZE,
  DEFAULT_RELATIVE_SIMILARITY_FLOOR,
} from "@netryx/shared-types";
import { getPool } from "../../../../../lib/db";
import { getSettingsRepo } from "../../../../../lib/settings-repo";
import { validateModelId } from "../../../../../lib/models/validate-model-id";
import { saveQueryImage } from "../../../../../lib/query-image-store";
import { embedQueryImage, classifyQueryImage } from "../../../../../lib/inference-client";
import { retrieveCandidates } from "../../../../../lib/search/retrieval";
import { queryExpansionRerank } from "../../../../../lib/search/rerank";
import { clusterCandidates } from "../../../../../lib/search/cluster";
import { persistSearch } from "../../../../../lib/search/persist";
import { runSearch, type RunSearchDeps } from "../../../../../lib/search/run-search";
import { validateImageBytes } from "../../../../../lib/image-validation";
import { findActiveModelForFacet } from "../../../../../lib/model-catalog/classification-models";
import { reportBatchPhase } from "../../../../../lib/search/batch-phase";

export async function POST(request: Request, { params }: { params: { modelId: string } }) {
  let activeModelId: string;
  try {
    activeModelId = (await getSettingsRepo().getSetting("RETRIEVAL_MODEL")) ?? "lumi-preview";
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not read settings" },
      { status: 502 }
    );
  }
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

  const batchIdField = form.get("batchId");
  const batchId = typeof batchIdField === "string" && batchIdField.length > 0 ? batchIdField : undefined;

  const bytes = Buffer.from(await file.arrayBuffer());

  const validation = await validateImageBytes(bytes);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  const imageBase64 = bytes.toString("base64");
  const imageExt = validation.format === "jpeg" ? "jpg" : validation.format;

  const pool = getPool();
  const timeOfDayModel = await findActiveModelForFacet(pool, "time_of_day");
  const inferenceBaseUrl = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";

  const deps: RunSearchDeps = {
    newSearchId: () => randomUUID(),
    embedQuery: (b64) => embedQueryImage(b64, inferenceBaseUrl),
    retrieve: (embedding) =>
      retrieveCandidates(pool, embedding, DEFAULT_TOP_K, undefined, DEFAULT_RELATIVE_SIMILARITY_FLOOR),
    rerank: (embedding, candidates) =>
      queryExpansionRerank(embedding, candidates, DEFAULT_QUERY_EXPANSION_SIZE),
    cluster: (candidates) => clusterCandidates(candidates, DEFAULT_REGION_RADIUS_M),
    saveImage: (searchId, b, ext) => saveQueryImage(searchId, b, ext),
    persist: (args) => persistSearch(pool, args),
    ...(timeOfDayModel
      ? {
          classifyTimeOfDay: async (b64: string) => {
            try {
              const groups = await classifyQueryImage(b64, timeOfDayModel.modelId, inferenceBaseUrl);
              const group = groups.find((g) => g.facet === "time_of_day");
              const top = group?.labels[0];
              return top ? { label: top.name, score: top.score } : null;
            } catch {
              // Time-of-day is decorative, not core — never fail the search
              // over a classify error (spec: docs/superpowers/specs/2026-
              // 07-21-results-layout-and-time-of-day-design.md).
              return null;
            }
          },
        }
      : {}),
    ...(batchId
      ? {
          reportPhase: (phase: "embedding" | "searching" | "saving") => {
            void reportBatchPhase(pool, batchId, phase).catch(() => {});
          },
        }
      : {}),
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
