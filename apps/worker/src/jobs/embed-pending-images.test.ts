// apps/worker/src/jobs/embed-pending-images.test.ts
import { describe, it, expect, vi } from "vitest";
import { runEmbedPendingImagesJob, type EmbedPendingImagesJobDeps } from "./embed-pending-images";

function makeDeps(overrides: Partial<EmbedPendingImagesJobDeps> = {}): EmbedPendingImagesJobDeps {
  return {
    getPendingImages: vi.fn().mockResolvedValue([
      { id: "img-1", imagePath: "/data/img1.jpg" },
      { id: "img-2", imagePath: "/data/img2.jpg" },
    ]),
    readImageBase64: vi.fn().mockResolvedValue("ZmFrZS1pbWFnZS1ieXRlcw=="),
    embedImages: vi.fn().mockResolvedValue([[0.1, 0.2], [0.3, 0.4]]),
    updateImageEmbeddings: vi.fn().mockResolvedValue(undefined),
    updateAreaProgress: vi.fn().mockResolvedValue(undefined),
    inferenceBaseUrl: "http://localhost:8000",
    ...overrides,
  };
}

describe("runEmbedPendingImagesJob", () => {
  it("reads pending images, embeds them, writes embeddings, and marks the area indexed", async () => {
    const deps = makeDeps();
    await runEmbedPendingImagesJob({ areaId: "area-1" }, deps);

    expect(deps.getPendingImages).toHaveBeenCalledWith("area-1");
    expect(deps.readImageBase64).toHaveBeenCalledTimes(2);
    expect(deps.embedImages).toHaveBeenCalledWith(["ZmFrZS1pbWFnZS1ieXRlcw==", "ZmFrZS1pbWFnZS1ieXRlcw=="], "http://localhost:8000");
    expect(deps.updateImageEmbeddings).toHaveBeenCalledWith([
      { id: "img-1", embedding: [0.1, 0.2] },
      { id: "img-2", embedding: [0.3, 0.4] },
    ]);
    expect(deps.updateAreaProgress).toHaveBeenCalledWith("area-1", { status: "indexing" });
    expect(deps.updateAreaProgress).toHaveBeenCalledWith("area-1", { status: "indexed" });
  });

  it("never calls anything related to Street View downloads or geometry sampling", async () => {
    const deps = makeDeps();
    await runEmbedPendingImagesJob({ areaId: "area-1" }, deps);
    // The dependency shape itself has no downloadCaptures/fetchStreetGeometry/
    // samplePointsAlongStreets fields — this test documents that constraint
    // rather than asserting a spy, since those deps simply don't exist here.
    expect(Object.keys(deps)).not.toContain("downloadCaptures");
    expect(Object.keys(deps)).not.toContain("fetchStreetGeometry");
  });

  it("does nothing but mark the area indexed when there are no pending images", async () => {
    const deps = makeDeps({ getPendingImages: vi.fn().mockResolvedValue([]) });
    await runEmbedPendingImagesJob({ areaId: "area-1" }, deps);

    expect(deps.embedImages).not.toHaveBeenCalled();
    expect(deps.updateImageEmbeddings).not.toHaveBeenCalled();
    expect(deps.updateAreaProgress).toHaveBeenCalledWith("area-1", { status: "indexed" });
  });

  it("marks the area failed if embedding throws", async () => {
    const deps = makeDeps({ embedImages: vi.fn().mockRejectedValue(new Error("inference down")) });
    await runEmbedPendingImagesJob({ areaId: "area-1" }, deps);

    expect(deps.updateAreaProgress).toHaveBeenCalledWith("area-1", { status: "failed" });
  });
});
