// packages/shared-types/src/jobs.test.ts
import { describe, it, expect } from "vitest";
import { INDEX_AREA_JOB_NAME, STREET_VIEW_HEADINGS, EMBED_PENDING_IMAGES_JOB_NAME, ANALYZE_IMAGE_BATCH_JOB_NAME, type AnalyzeImageBatchJobPayload } from "./jobs";
import type { EmbedPendingImagesJobPayload } from "./jobs";

describe("job constants", () => {
  it("names the indexing job consistently for enqueue and consume", () => {
    expect(INDEX_AREA_JOB_NAME).toBe("index-area");
  });

  it("captures 4 cardinal headings per point (spec §4)", () => {
    expect(STREET_VIEW_HEADINGS).toEqual([0, 90, 180, 270]);
  });
});

describe("EMBED_PENDING_IMAGES_JOB_NAME", () => {
  it("is a distinct job name from index-area", () => {
    expect(EMBED_PENDING_IMAGES_JOB_NAME).toBe("embed-pending-images");
  });

  it("payload only needs an areaId", () => {
    const payload: EmbedPendingImagesJobPayload = { areaId: "abc" };
    expect(payload.areaId).toBe("abc");
  });
});

describe("ANALYZE_IMAGE_BATCH_JOB_NAME", () => {
  it("is a stable, unique job name", () => {
    expect(ANALYZE_IMAGE_BATCH_JOB_NAME).toBe("analyze-image-batch");
  });

  it("payload shape carries batchId, imageIds and modelId", () => {
    const payload: AnalyzeImageBatchJobPayload = {
      batchId: "b1",
      imageIds: ["img1", "img2"],
      modelId: "lumi-preview",
    };
    expect(payload.imageIds).toHaveLength(2);
  });
});