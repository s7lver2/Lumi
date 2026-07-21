// apps/web/lib/inference-client.ts
import type { Pool } from "pg";
import { recordModelUsage } from "@netryx/model-usage";

/** Embeds a single query image with Lumi Preview TTA on (spec §15.1). */
export async function embedQueryImage(
  imageBase64: string,
  inferenceBaseUrl: string,
  pool: Pool
): Promise<number[]> {
  const res = await fetch(`${inferenceBaseUrl}/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ images_base64: [imageBase64], augment: true }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Inference service /embed failed (${res.status}): ${detail}`);
  }

  const body = (await res.json()) as { embeddings: number[][]; duration_ms: number };
  recordModelUsage(pool, "retrieval", body.duration_ms).catch(() => {});
  return body.embeddings[0];
}

export interface ClassifyLabel {
  name: string;
  score: number;
}

export interface ClassifyGroup {
  facet: string;
  labels: ClassifyLabel[];
}

/** Runs one installed generic-classifier model's facets against a single
 * image (spec: docs/superpowers/specs/2026-07-21-results-layout-and-time-
 * of-day-design.md). Labels within each group are already sorted
 * descending by score by the inference service. */
export async function classifyQueryImage(
  imageBase64: string,
  modelId: string,
  inferenceBaseUrl: string,
  pool: Pool
): Promise<ClassifyGroup[]> {
  const res = await fetch(`${inferenceBaseUrl}/models/${modelId}/classify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image_base64: imageBase64 }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Inference service /models/${modelId}/classify failed (${res.status}): ${detail}`);
  }

  const body = (await res.json()) as { groups: ClassifyGroup[]; duration_ms: number };
  recordModelUsage(pool, modelId, body.duration_ms).catch(() => {});
  return body.groups;
}
