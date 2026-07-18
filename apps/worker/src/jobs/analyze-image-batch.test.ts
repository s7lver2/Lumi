// apps/worker/src/jobs/analyze-image-batch.test.ts
import { describe, it, expect, vi } from "vitest";
import { runAnalyzeImageBatchJob } from "./analyze-image-batch";

describe("runAnalyzeImageBatchJob", () => {
  it("analyzes each image, reports progress, and marks the batch done with the first result", async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    const result1 = { searchId: "s1", regions: [], candidatesByRegion: {} };
    const result2 = { searchId: "s2", regions: [], candidatesByRegion: {} };
    const analyzeOne = vi.fn().mockResolvedValueOnce(result1).mockResolvedValueOnce(result2);
    const getImageBytes = vi.fn().mockResolvedValue(Buffer.from("bytes"));

    await runAnalyzeImageBatchJob(
      { batchId: "b1", imageIds: ["img1", "img2"], modelId: "lumi-preview" },
      { getImageBytes, analyzeOne, updateProgress }
    );

    expect(updateProgress).toHaveBeenCalledWith("b1", { status: "running" });
    expect(analyzeOne).toHaveBeenCalledTimes(2);
    expect(updateProgress).toHaveBeenCalledWith("b1", { done: 1 });
    expect(updateProgress).toHaveBeenCalledWith("b1", { done: 2 });
    // Only the first successful image's result is reported — see the
    // comment in analyze-image-batch.ts on why results aren't merged.
    expect(updateProgress).toHaveBeenCalledWith("b1", { status: "done", result: result1 });
  });

  it("counts a missing image as failed and marks the batch failed when nothing succeeds", async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    const analyzeOne = vi.fn().mockResolvedValue(undefined);
    const getImageBytes = vi.fn().mockResolvedValue(null);

    await runAnalyzeImageBatchJob(
      { batchId: "b1", imageIds: ["missing"], modelId: "lumi-preview" },
      { getImageBytes, analyzeOne, updateProgress }
    );

    expect(analyzeOne).not.toHaveBeenCalled();
    expect(updateProgress).toHaveBeenCalledWith("b1", { failed: 1 });
    expect(updateProgress).toHaveBeenCalledWith("b1", { status: "failed" });
  });

  it("counts a per-image analyze failure without aborting the rest of the batch", async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    const result = { searchId: "s1", regions: [], candidatesByRegion: {} };
    const analyzeOne = vi.fn().mockRejectedValueOnce(new Error("estimate failed")).mockResolvedValueOnce(result);
    const getImageBytes = vi.fn().mockResolvedValue(Buffer.from("bytes"));

    await runAnalyzeImageBatchJob(
      { batchId: "b1", imageIds: ["img1", "img2"], modelId: "lumi-preview" },
      { getImageBytes, analyzeOne, updateProgress }
    );

    expect(analyzeOne).toHaveBeenCalledTimes(2);
    expect(updateProgress).toHaveBeenCalledWith("b1", { failed: 1 });
    expect(updateProgress).toHaveBeenCalledWith("b1", { done: 1 });
    expect(updateProgress).toHaveBeenCalledWith("b1", { status: "done", result });
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