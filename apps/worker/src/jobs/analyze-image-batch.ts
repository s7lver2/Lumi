// apps/worker/src/jobs/analyze-image-batch.ts
import type { AnalyzeImageBatchJobPayload } from "@netryx/shared-types";

export interface AnalyzeImageBatchJobDeps {
  getImageBytes: (imageId: string) => Promise<Buffer | null>;
  analyzeOne: (imageBytes: Buffer, modelId: string) => Promise<void>;
  updateProgress: (
    batchId: string,
    update: { status?: "pending" | "running" | "done" | "failed"; done?: number; failed?: number }
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

    for (const imageId of imageIds) {
      const bytes = await deps.getImageBytes(imageId);
      if (!bytes) {
        failed++;
        await deps.updateProgress(batchId, { failed });
        continue;
      }
      await deps.analyzeOne(bytes, modelId);
      done++;
      await deps.updateProgress(batchId, { done });
    }

    await deps.updateProgress(batchId, { status: "done" });
  } catch (err) {
    console.error(`[analyze-image-batch] batch ${batchId} failed:`, err);
    await deps.updateProgress(batchId, { status: "failed" }).catch(() => {});
  }
}