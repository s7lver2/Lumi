// apps/worker/src/jobs/index-area.test.ts
import { describe, it, expect, vi } from "vitest";
import { runIndexAreaJob, type IndexAreaJobDeps } from "./index-area";
import type { AreaRow } from "@netryx/shared-types";

function makeDeps(
  overrides: Partial<IndexAreaJobDeps> & { captures?: any[]; embeddings?: any[]; points?: any[]; settings?: Record<string, string> } = {}
): IndexAreaJobDeps {
  const area: AreaRow = {
    id: "area-1",
    name: null,
    areaKm2: 2,
    status: "pending",
    pointsEstimated: 0,
    pointsCaptured: 0,
    pointsFailed: 0,
    imagesEmbedded: 0,
    estimatedCostUsd: null,
    actualCostUsd: null,
  };

  return {
    getArea: vi.fn().mockResolvedValue(area),
    getAreaPolygon: vi.fn().mockResolvedValue([[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]),
    fetchStreetGeometry: vi.fn().mockResolvedValue([
      { type: "LineString", coordinates: [[0, 0], [0, 0.001]] },
    ]),
    samplePointsAlongStreets: vi.fn().mockReturnValue(
      overrides.points ?? [
        { lat: 0, lng: 0 },
        { lat: 0.0005, lng: 0 },
      ]
    ),
    loadExistingPanoHeadings: vi.fn().mockResolvedValue(new Set<string>()),
    downloadCaptures: overrides.downloadCaptures ?? vi.fn().mockResolvedValue({
      captures: overrides.captures ?? [
        { panoId: "p1", heading: 0, lat: 0, lng: 0, captureDate: "2024-01", imageBase64: "aaa" },
        { panoId: "p2", heading: 90, lat: 0.0005, lng: 0, captureDate: "2024-01", imageBase64: "bbb" },
      ],
      failedPoints: 0,
    }),
    embedImages: vi.fn().mockResolvedValue(
      overrides.embeddings ?? [
        [0.1, 0.2],
        [0.3, 0.4],
      ]
    ),
    insertIndexedImages: vi.fn().mockResolvedValue(undefined),
    insertIndexedPoints: overrides.insertIndexedPoints ?? vi.fn().mockResolvedValue(undefined),
    saveCaptureImage: overrides.saveCaptureImage ?? vi.fn().mockImplementation(
      async (panoId: string, heading: number) => `/imgs/${panoId}_${heading}.jpg`
    ),
    updateAreaProgress: vi.fn().mockResolvedValue(undefined),
    getSetting: vi.fn(async (key: string) => {
      const values: Record<string, string> = {
        GOOGLE_MAPS_API_KEY: "test-key",
        MAX_CONCURRENT_REQUESTS: "5",
        STREET_VIEW_PRICE_PER_IMAGE_USD: "0.007",
        MAX_MONTHLY_BUDGET_USD: "50",
        ...overrides.settings, // Permite inyectar configuraciones dinámicas desde los tests
      };
      return values[key] ?? null;
    }),
    inferenceBaseUrl: "http://localhost:8000",
    
    // 🛠️ MOCKS GLOBALES POR DEFECTO PARA EVITAR MÚLTIPLES TYPEERRORS
    getMonthlySpendUsd: overrides.getMonthlySpendUsd ?? vi.fn().mockResolvedValue(0),
    recordStreetViewUsage: overrides.recordStreetViewUsage ?? vi.fn().mockResolvedValue(undefined),
    isCancelled: overrides.isCancelled ?? vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe("runIndexAreaJob", () => {
  it("walks the full pipeline and marks the area indexed", async () => {
    const deps = makeDeps();

    await runIndexAreaJob({ areaId: "area-1" }, deps);

    expect(deps.fetchStreetGeometry).toHaveBeenCalledWith([[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]);
    expect(deps.downloadCaptures).toHaveBeenCalled();
    expect(deps.embedImages).toHaveBeenCalledWith(["aaa", "bbb"], "http://localhost:8000");
    expect(deps.insertIndexedImages).toHaveBeenCalledWith(
      "area-1",
      expect.arrayContaining([
        expect.objectContaining({ panoId: "p1", embedding: [0.1, 0.2] }),
        expect.objectContaining({ panoId: "p2", embedding: [0.3, 0.4] }),
      ])
    );

    const statusCalls = (deps.updateAreaProgress as any).mock.calls.map((c: any[]) => c[1]);
    expect(statusCalls[0]).toEqual(expect.objectContaining({ status: "indexing" }));
    expect(statusCalls[statusCalls.length - 1]).toEqual(
      expect.objectContaining({ status: "indexed", pointsCaptured: 2, imagesEmbedded: 2 })
    );
  });

  it("computes actual_cost_usd from the number of images actually downloaded, not the estimate", async () => {
    const deps = makeDeps();
    await runIndexAreaJob({ areaId: "area-1" }, deps);

    const finalUpdate = (deps.updateAreaProgress as any).mock.calls.at(-1)[1];
    expect(finalUpdate.actualCostUsd).toBeCloseTo(2 * 0.007, 5);
  });

  it("marks the area failed (not indexed) and records points_failed when NO images were embedded at all", async () => {
    const deps = makeDeps({
      downloadCaptures: vi.fn().mockResolvedValue({ captures: [], failedPoints: 2 }),
    });

    await runIndexAreaJob({ areaId: "area-1" }, deps);

    const finalUpdate = (deps.updateAreaProgress as any).mock.calls.at(-1)[1];
    expect(finalUpdate.status).toBe("failed");
    expect(finalUpdate.pointsFailed).toBe(2);
    expect(deps.embedImages).not.toHaveBeenCalled();
  });

  it("still marks the area indexed (partial success) when some but not all points failed", async () => {
    const deps = makeDeps({
      downloadCaptures: vi.fn().mockResolvedValue({
        captures: [{ panoId: "p1", heading: 0, lat: 0, lng: 0, captureDate: null, imageBase64: "aaa" }],
        failedPoints: 1,
      }),
      embedImages: vi.fn().mockResolvedValue([[0.1, 0.2]]),
    });

    await runIndexAreaJob({ areaId: "area-1" }, deps);

    const finalUpdate = (deps.updateAreaProgress as any).mock.calls.at(-1)[1];
    expect(finalUpdate.status).toBe("indexed");
    expect(finalUpdate.pointsFailed).toBe(1);
    expect(finalUpdate.imagesEmbedded).toBe(1);
  });

  it("marks the area failed if the inference service throws, without insertIndexedImages ever running", async () => {
    const deps = makeDeps({
      embedImages: vi.fn().mockRejectedValue(new Error("inference service unreachable")),
    });

    await runIndexAreaJob({ areaId: "area-1" }, deps);

    expect(deps.insertIndexedImages).not.toHaveBeenCalled();
    const finalUpdate = (deps.updateAreaProgress as any).mock.calls.at(-1)[1];
    expect(finalUpdate.status).toBe("failed");
  });

  it("computes and persists one aggregate descriptor per pano (spec §15.1)", async () => {
    const insertIndexedPoints = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      captures: [
        { panoId: "pano-a", heading: 0, lat: 1, lng: 2, captureDate: null, imageBase64: "x" },
        { panoId: "pano-a", heading: 90, lat: 1, lng: 2, captureDate: null, imageBase64: "y" },
        { panoId: "pano-b", heading: 0, lat: 3, lng: 4, captureDate: null, imageBase64: "z" },
      ],
      embeddings: [
        [1, 0],
        [0, 1],
        [1, 1],
      ],
      insertIndexedPoints,
    });

    await runIndexAreaJob({ areaId: "area-1" }, deps);

    expect(insertIndexedPoints).toHaveBeenCalledTimes(1);
    const [, points] = insertIndexedPoints.mock.calls[0];
    expect(points).toHaveLength(2);
  });

  it("saves each capture image and records its path on the indexed_images insert (spec §9.3)", async () => {
    const saveCaptureImage = vi
      .fn()
      .mockImplementation(async (panoId: string, heading: number) => `/imgs/${panoId}_${heading}.jpg`);
    const insertIndexedImages = vi.fn().mockResolvedValue(undefined);

    const deps = makeDeps({
      captures: [
        { panoId: "pano-a", heading: 0, lat: 1, lng: 2, captureDate: null, imageBase64: "AAECAw==" },
      ],
      embeddings: [[1, 0]],
      saveCaptureImage,
      insertIndexedImages,
    });

    await runIndexAreaJob({ areaId: "area-1" }, deps);

    expect(saveCaptureImage).toHaveBeenCalledWith("pano-a", 0, "AAECAw==");
    const [, images] = insertIndexedImages.mock.calls[0];
    expect(images[0].imagePath).toBe("/imgs/pano-a_0.jpg");
  });

  it("fails the area without downloading when the projected cost exceeds the monthly budget (spec §12.2)", async () => {
    const downloadCaptures = vi.fn().mockResolvedValue({ captures: [], failedPoints: 0 });
    const deps = makeDeps({
      settings: { 
        GOOGLE_MAPS_API_KEY: "k", 
        MAX_MONTHLY_BUDGET_USD: "10", 
        STREET_VIEW_PRICE_PER_IMAGE_USD: "0.007" 
      },
      points: new Array(1000).fill({ lat: 1, lng: 2 }), // 1000 puntos * 4 headings * 0.007 = $28 proyectados (Excede el límite de $10)
      getMonthlySpendUsd: vi.fn().mockResolvedValue(0),
      downloadCaptures,
    });

    await runIndexAreaJob({ areaId: "area-1" }, deps);

    // Comprobamos que el pipeline se detuvo antes de consumir APIs externas
    expect(downloadCaptures).not.toHaveBeenCalled();
    const statuses = (deps.updateAreaProgress as any).mock.calls.map((c: any[]) => c[1].status).filter(Boolean);
    expect(statuses).toContain("failed");
  });

  it("records served-image usage after a successful download (spec §12.3)", async () => {
    const recordStreetViewUsage = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      captures: [
        { panoId: "p", heading: 0, lat: 1, lng: 2, captureDate: null, imageBase64: "x" },
        { panoId: "p", heading: 90, lat: 1, lng: 2, captureDate: null, imageBase64: "y" },
      ],
      embeddings: [[1, 0], [0, 1]],
      getMonthlySpendUsd: vi.fn().mockResolvedValue(0),
      recordStreetViewUsage,
    });

    await runIndexAreaJob({ areaId: "area-1" }, deps);

    expect(recordStreetViewUsage).toHaveBeenCalledWith(2, 0.007);
  });

  it("bails out immediately, without touching status, when already cancelled before it starts", async () => {
    const deps = makeDeps({ isCancelled: vi.fn().mockResolvedValue(true) });

    await runIndexAreaJob({ areaId: "area-1" }, deps);

    expect(deps.fetchStreetGeometry).not.toHaveBeenCalled();
    expect(deps.downloadCaptures).not.toHaveBeenCalled();
    expect(deps.updateAreaProgress).not.toHaveBeenCalled();
  });

  it("stops after a cancelled download without marking the area failed or indexed", async () => {
    const downloadCaptures = vi.fn().mockResolvedValue({ captures: [], failedPoints: 0, cancelled: true });
    const deps = makeDeps({ downloadCaptures });

    await runIndexAreaJob({ areaId: "area-1" }, deps);

    expect(deps.embedImages).not.toHaveBeenCalled();
    const statuses = (deps.updateAreaProgress as any).mock.calls.map((c: any[]) => c[1].status).filter(Boolean);
    expect(statuses).not.toContain("failed");
    expect(statuses).not.toContain("indexed");
  });

  it("passes a shouldCancel callback into downloadCaptures backed by isCancelled", async () => {
    const isCancelled = vi.fn().mockResolvedValue(false);
    const downloadCaptures = vi.fn().mockResolvedValue({ captures: [], failedPoints: 0, cancelled: false });
    const deps = makeDeps({ downloadCaptures, isCancelled });

    await runIndexAreaJob({ areaId: "area-1" }, deps);

    const opts = downloadCaptures.mock.calls[0][2];
    expect(typeof opts.shouldCancel).toBe("function");
    await opts.shouldCancel();
    expect(isCancelled).toHaveBeenCalledWith("area-1");
  });
    it("catches an error from BEFORE downloadCaptures (e.g. fetchStreetGeometry/Overpass), logs it, and marks the area failed instead of leaving it stuck", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps({
      fetchStreetGeometry: vi.fn().mockRejectedValue(new Error("Overpass 504")),
    });

    await expect(runIndexAreaJob({ areaId: "area-1" }, deps)).resolves.toBeUndefined();

    const statuses = (deps.updateAreaProgress as any).mock.calls.map((c: any[]) => c[1].status).filter(Boolean);
    expect(statuses).toContain("failed");
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("does not overwrite an already-cancelled area with failed when a later step throws", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps({
      isCancelled: vi.fn().mockResolvedValue(false).mockResolvedValueOnce(false).mockResolvedValueOnce(false),
      insertIndexedImages: vi.fn().mockRejectedValue(new Error("db write failed")),
    });
    // Simulate: cancelled flips true only by the time the outer catch checks it.
    (deps.isCancelled as any).mockResolvedValue(true);

    await runIndexAreaJob({ areaId: "area-1" }, deps);

    const statuses = (deps.updateAreaProgress as any).mock.calls.map((c: any[]) => c[1].status).filter(Boolean);
    expect(statuses).not.toContain("failed");
    consoleErrorSpy.mockRestore();
  });
});