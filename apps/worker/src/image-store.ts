// apps/worker/src/image-store.ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

function imageDir(): string {
  return process.env.STREET_VIEW_IMAGE_DIR ?? join(process.cwd(), "data", "street-view");
}

/** Deterministic on-disk path for a capture — pano+heading is unique (indexed_images UNIQUE). */
export function captureImagePath(panoId: string, heading: number): string {
  // pano ids are URL-safe already; heading is a small int. No sanitization needed.
  return join(imageDir(), `${panoId}_${heading}.jpg`);
}

/** Writes the base64 Street View image to its deterministic path; returns the path. */
export async function saveCaptureImage(
  panoId: string,
  heading: number,
  base64: string
): Promise<string> {
  await mkdir(imageDir(), { recursive: true });
  const path = captureImagePath(panoId, heading);
  await writeFile(path, Buffer.from(base64, "base64"));
  return path;
}