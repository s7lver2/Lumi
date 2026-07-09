// apps/web/lib/verify-client.ts

export interface VerifyResult {
  inliers: number;
  reprojError: number;
  score: number;
}

/** Calls the inference /verify endpoint (Laila) for one query vs. many candidates. */
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