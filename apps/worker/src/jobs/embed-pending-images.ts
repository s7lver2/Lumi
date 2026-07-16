// apps/worker/src/jobs/embed-pending-images.ts
import type { EmbedPendingImagesJobPayload } from "@netryx/shared-types";
import type { AreaProgressUpdate } from "../progress";

export interface PendingEmbedImageDep {
  id: string;
  imagePath: string;
}

export interface EmbedPendingImagesJobDeps {
  getPendingImages: (areaId: string) => Promise<PendingEmbedImageDep[]>;
  readImageBase64: (imagePath: string) => Promise<string>;
  embedImages: (imagesBase64: string[], inferenceBaseUrl: string) => Promise<number[][]>;
  updateImageEmbeddings: (updates: { id: string; embedding: number[] }[]) => Promise<void>;
  updateAreaProgress: (areaId: string, update: AreaProgressUpdate) => Promise<void>;
  inferenceBaseUrl: string;
}

// Same chunk size as apps/worker/src/jobs/index-area.ts's EMBED_CHUNK_SIZE,
// for the same reason: embedding one giant batch OOMs the CPU-bound
// inference service.
const EMBED_CHUNK_SIZE = 16;

/**
 * Fills in embeddings for images that are already on disk but have
 * `embedding IS NULL` — the state left behind by installing a dataset
 * release built with a different model (spec's "Completing embeddings
 * after a mismatched install" section). Deliberately does NOT re-walk
 * street geometry or call Street View — no cost, no re-download, unlike
 * runIndexAreaJob (index-area.ts), whose global pano/heading dedup would
 * just skip these rows entirely instead of embedding them.
 */
export async function runEmbedPendingImagesJob(
  payload: EmbedPendingImagesJobPayload,
  deps: EmbedPendingImagesJobDeps
): Promise<void> {
  const { areaId } = payload;

  try {
    const pending = await deps.getPendingImages(areaId);

    if (pending.length === 0) {
      await deps.updateAreaProgress(areaId, { status: "indexed" });
      return;
    }

    await deps.updateAreaProgress(areaId, { status: "indexing" });

    for (let start = 0; start < pending.length; start += EMBED_CHUNK_SIZE) {
      const chunk = pending.slice(start, start + EMBED_CHUNK_SIZE);
      const imagesBase64 = await Promise.all(chunk.map((img) => deps.readImageBase64(img.imagePath)));
      const embeddings = await deps.embedImages(imagesBase64, deps.inferenceBaseUrl);

      await deps.updateImageEmbeddings(
        chunk.map((img, i) => ({ id: img.id, embedding: embeddings[i] }))
      );
    }

    await deps.updateAreaProgress(areaId, { status: "indexed" });
  } catch (err) {
    console.error(`[embed-pending-images] job for area ${areaId} failed:`, err);
    await deps.updateAreaProgress(areaId, { status: "failed" }).catch(() => {});
  }
}
