// apps/worker/src/jobs/analyze-image-batch.test.ts
import { describe, it, expect, vi } from "vitest";
import { runAnalyzeImageBatchJob } from "./analyze-image-batch";

describe("runAnalyzeImageBatchJob", () => {
  it("analyzes each image, reports progress, and marks the batch done", async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    const analyzeOne = vi.fn().mockResolvedValue(undefined);
    const getImageBytes = vi.fn().mockResolvedValue(Buffer.from("bytes"));

    await runAnalyzeImageBatchJob(
      { batchId: "b1", imageIds: ["img1", "img2"], modelId: "lumi-preview" },
      { getImageBytes, analyzeOne, updateProgress }
    );

    expect(updateProgress).toHaveBeenCalledWith("b1", { status: "running" });
    expect(analyzeOne).toHaveBeenCalledTimes(2);
    expect(updateProgress).toHaveBeenCalledWith("b1", { done: 1 });
    expect(updateProgress).toHaveBeenCalledWith("b1", { done: 2 });
    expect(updateProgress).toHaveBeenCalledWith("b1", { status: "done" });
  });

  it("counts a missing image as failed rather than throwing", async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    const analyzeOne = vi.fn().mockResolvedValue(undefined);
    const getImageBytes = vi.fn().mockResolvedValue(null);

    await runAnalyzeImageBatchJob(
      { batchId: "b1", imageIds: ["missing"], modelId: "lumi-preview" },
      { getImageBytes, analyzeOne, updateProgress }
    );

    expect(analyzeOne).not.toHaveBeenCalled();
    expect(updateProgress).toHaveBeenCalledWith("b1", { failed: 1 });
    expect(updateProgress).toHaveBeenCalledWith("b1", { status: "done" });
  });

  it("marks the batch failed if an unexpected error occurs", async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    const getImageBytes = vi.fn().mockRejectedValue(new Error("boom"));

    await runAnalyzeImageBatchJob(
      { batchId: "b1", imageIds: ["img1"], modelId: "lumi-preview" },
      { getImageBytes, analyzeOne: vi.fn(), updateProgress }
    );

    expect(updateProgress).toHaveBeenCalledWith("b1", { status: "failed" });
  });
});