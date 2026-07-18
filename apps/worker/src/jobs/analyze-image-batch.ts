// apps/worker/src/jobs/analyze-image-batch.ts
import type { AnalyzeImageBatchJobPayload, SearchResponse } from "@netryx/shared-types";

export interface AnalyzeImageBatchJobDeps {
  getImageBytes: (imageId: string) => Promise<Buffer | null>;
  analyzeOne: (imageBytes: Buffer, modelId: string) => Promise<SearchResponse>;
  updateProgress: (
    batchId: string,
    update: {
      status?: "pending" | "running" | "done" | "failed";
      done?: number;
      failed?: number;
      result?: SearchResponse;
    }
  ) => Promise<void>;
}

export async function runAnalyzeImageBatchJob(
  payload: AnalyzeImageBatchJobPayload,
  deps: AnalyzeImageBatchJobDeps
): Promise<void> {
  const { batchId, imageIds, modelId } = payload;

  try {
    await deps.updateProgress(batchId, { status: "running" });

    let done = 0;
    let failed = 0;
    // The searchId/regions/candidatesByRegion of each individual image's
    // estimate are only mutually consistent within that one search — a
    // region's refine lookup is keyed by (searchId, regionId) against that
    // search's own persisted rows. Rather than merging results across
    // multiple distinct searches (which would break refine for all but one
    // of them), the first successful image's result is what the batch
    // reports; later images in the same batch only contribute to progress.
    let result: SearchResponse | undefined;

    for (const imageId of imageIds) {
      const bytes = await deps.getImageBytes(imageId);
      if (!bytes) {
        failed++;
        await deps.updateProgress(batchId, { failed });
        continue;
      }
      try {
        const one = await deps.analyzeOne(bytes, modelId);
        if (!result) result = one;
        done++;
        await deps.updateProgress(batchId, { done });
      } catch (err) {
        console.error(`[analyze-image-batch] image ${imageId} in batch ${batchId} failed:`, err);
        failed++;
        await deps.updateProgress(batchId, { failed });
      }
    }

    if (!result) {
      await deps.updateProgress(batchId, { status: "failed" });
      return;
    }
    await deps.updateProgress(batchId, { status: "done", result });
  } catch (err) {
    console.error(`[analyze-image-batch] batch ${batchId} failed:`, err);
    await deps.updateProgress(batchId, { status: "failed" }).catch(() => {});
  }
}