import type { IndexAreaJobPayload, AreaRow, SampledPoint, StreetViewCapture } from "@netryx/shared-types";
import { STREET_VIEW_HEADINGS } from "@netryx/shared-types";
import type { LineStringGeoJSON } from "@netryx/geo-sampling";
import type { AreaProgressUpdate } from "../progress";
import { aggregatePanoDescriptors, type IndexedPointInsert } from "../aggregate";


export interface IndexedImageInsert {
    panoId: string;
    heading: number;
    lat: number;
    lng: number;
    captureDate: string | null;
    embedding: number[];
    imagePath: string;
}

export interface IndexAreaJobDeps {
    getArea: (areaId: string) => Promise<AreaRow>;
    getAreaPolygon: (areaId: string) => Promise<[number, number][]>;
    fetchStreetGeometry: (polygon: [number, number][]) => Promise<LineStringGeoJSON[]>;
    samplePointsAlongStreets: (lines: LineStringGeoJSON[], spacingMeters: number) => SampledPoint[];
    loadExistingPanoHeadings: () => Promise<Set<string>>;
    downloadCaptures: (
        points: SampledPoint[],
        headings: readonly number[],
        opts: { apiKey: string; maxConcurrent: number; existingPanoHeadings: Set<string> }
    ) => Promise<{ captures: StreetViewCapture[]; failedPoints: number }>;
    embedImages: (imagesBase64: string[], inferenceBaseUrl: string) => Promise<number[][]>;
    insertIndexedImages: (areaId: string, images: IndexedImageInsert[]) => Promise<void>;
    updateAreaProgress: (areaId: string, update: AreaProgressUpdate) => Promise<void>;
    getSetting: (key: string) => Promise<string | null>;
    inferenceBaseUrl: string;
    insertIndexedPoints: (areaId: string, points: IndexedPointInsert[]) => Promise<void>;
    saveCaptureImage: (panoId: string, heading: number, base64: string) => Promise<string>;
}

const SAMPLING_SPACING_METERS = 18; // midpoint of the spec's "every ~15-20m" (spec §4 step 2)

export async function runIndexAreaJob(
    payload: IndexAreaJobPayload,
    deps: IndexAreaJobDeps
): Promise<void> {
    const { areaId } = payload;

    await deps.updateAreaProgress(areaId, { status: "indexing" });

    const [polygon, apiKey, maxConcurrentRaw, pricePerImageRaw, existingPanoHeadings] = await Promise.all([
        deps.getAreaPolygon(areaId),
        deps.getSetting("GOOGLE_MAPS_API_KEY"),
        deps.getSetting("MAX_CONCURRENT_REQUESTS"),
        deps.getSetting("STREET_VIEW_PRICE_PER_IMAGE_USD"),
        deps.loadExistingPanoHeadings(),
    ]);

    if (!apiKey) {
        await deps.updateAreaProgress(areaId, { status: "failed" });
        throw new Error("GOOGLE_MAPS_API_KEY is not configured — cannot index (spec §14.5)");
    }

    const maxConcurrent = Number(maxConcurrentRaw ?? 10);
    const pricePerImageUsd = Number(pricePerImageRaw ?? 0.007);

    const lines = await deps.fetchStreetGeometry(polygon);
    const points = deps.samplePointsAlongStreets(lines, SAMPLING_SPACING_METERS);

    await deps.updateAreaProgress(areaId, { pointsEstimated: points.length });

    const { captures, failedPoints } = await deps.downloadCaptures(points, STREET_VIEW_HEADINGS, {
        apiKey,
        maxConcurrent,
        existingPanoHeadings,
    });

    const pointsCaptured = points.length - failedPoints;

    await deps.updateAreaProgress(areaId, {
        pointsCaptured,
        pointsFailed: failedPoints,
    });

    if (captures.length === 0) {
        await deps.updateAreaProgress(areaId, { status: "failed", pointsFailed: failedPoints });
        return;
    }

    let embeddings: number[][];
    try {
        embeddings = await deps.embedImages(
            captures.map((c) => c.imageBase64),
            deps.inferenceBaseUrl
        );
    } catch (err) {
        await deps.updateAreaProgress(areaId, { status: "failed", pointsFailed: failedPoints });
        return;
    }

    const inserts: IndexedImageInsert[] = [];
    for (let i = 0; i < captures.length; i++) {
      const capture = captures[i];
      const imagePath = await deps.saveCaptureImage(
        capture.panoId,
        capture.heading,
        capture.imageBase64
      );
      inserts.push({
        panoId: capture.panoId,
        heading: capture.heading,
        lat: capture.lat,
        lng: capture.lng,
        captureDate: capture.captureDate,
        embedding: embeddings[i],
        imagePath,
      });
    }

    await deps.insertIndexedImages(areaId, inserts);

    const aggregatePoints = aggregatePanoDescriptors(captures, embeddings);
    await deps.insertIndexedPoints(areaId, aggregatePoints);

    const actualCostUsd = captures.length * pricePerImageUsd;

    await deps.updateAreaProgress(areaId, {
        status: "indexed",
        pointsCaptured,
        pointsFailed: failedPoints,
        imagesEmbedded: inserts.length,
        actualCostUsd,
    });
}