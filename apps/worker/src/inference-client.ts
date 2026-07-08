// apps/worker/src/inference-client.ts

export async function embedImages(
  imagesBase64: string[],
  inferenceBaseUrl: string
): Promise<number[][]> {
  const res = await fetch(`${inferenceBaseUrl}/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ images_base64: imagesBase64 }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Inference service /embed failed (${res.status}): ${detail}`);
  }

  const body = (await res.json()) as { embeddings: number[][] };
  return body.embeddings;
}