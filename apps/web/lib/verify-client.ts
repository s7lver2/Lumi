// apps/web/lib/verify-client.ts

export interface VerifyResult {
  inliers: number;
  reprojError: number;
  score: number;
}

/** Calls the inference /verify endpoint (RoMa-based geometric verification) for one query vs. many candidates. */
export async function verifyCandidates(
  queryBase64: string,
  candidateBase64: string[],
  inferenceBaseUrl: string
): Promise<VerifyResult[]> {
  const res = await fetch(`${inferenceBaseUrl}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query_image_base64: queryBase64,
      candidate_images_base64: candidateBase64,
    }),
    // RoMa (dense pairwise matching) is slow but bounded per single candidate
    // (run-refine.ts sends one at a time) — this is a safety net against a
    // genuinely stuck request (e.g. the inference process crashed but the
    // connection never closed), not a performance target. If this actually
    // fires, run-refine.ts's own retry-then-fall-back-to-unscored handling
    // (not a page reload) is what recovers the rest of the batch.
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Inference service /verify failed (${res.status}): ${detail}`);
  }

  const body = (await res.json()) as {
    results: { inliers: number; reproj_error: number; score: number }[];
  };
  return body.results.map((r) => ({
    inliers: r.inliers,
    reprojError: r.reproj_error,
    score: r.score,
  }));
}