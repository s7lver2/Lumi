// apps/web/lib/inference-client.ts

/** Embeds a single query image with Lumi Preview TTA on (spec §15.1). */
export async function embedQueryImage(
  imageBase64: string,
  inferenceBaseUrl: string
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

  const body = (await res.json()) as { embeddings: number[][] };
  return body.embeddings[0];
}