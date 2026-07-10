// apps/worker/src/jobs/index-area.ts

import type { IndexAreaJobPayload, AreaRow, SampledPoint, StreetViewCapture } from "@netryx/shared-types";
import { STREET_VIEW_HEADINGS } from "@netryx/shared-types";
import type { LineStringGeoJSON } from "@netryx/geo-sampling";
import type { AreaProgressUpdate } from "../progress";
import { aggregatePanoDescriptors, type IndexedPointInsert } from "../aggregate";
import {
    projectedCostUsd,
    freeAllowanceUsd,
    netCostBreakdown,
} from "@netryx/api-usage";

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
        opts: {
            apiKey: string;
            maxConcurrent: number;
            existingPanoHeadings: Set<string>;
            shouldCancel?: () => Promise<boolean> | boolean;
        }
    ) => Promise<{ captures: StreetViewCapture[]; failedPoints: number; cancelled: boolean }>;
    embedImages: (imagesBase64: string[], inferenceBaseUrl: string) => Promise<number[][]>;
    insertIndexedImages: (areaId: string, images: IndexedImageInsert[]) => Promise<void>;
    updateAreaProgress: (areaId: string, update: AreaProgressUpdate) => Promise<void>;
    getSetting: (key: string) => Promise<string | null>;
    inferenceBaseUrl: string;
    insertIndexedPoints: (areaId: string, points: IndexedPointInsert[]) => Promise<void>;
    saveCaptureImage: (panoId: string, heading: number, base64: string) => Promise<string>;
    getMonthlySpendUsd: () => Promise<number>;
    recordStreetViewUsage: (requests: number, pricePerImageUsd: number) => Promise<void>;
    /** Cooperative cancellation: has the user cancelled this area from the UI? */
    isCancelled: (areaId: string) => Promise<boolean>;
}

const SAMPLING_SPACING_METERS = 18; // midpoint of the spec's "every ~15-20m" (spec §4 step 2)

export async function runIndexAreaJob(
    payload: IndexAreaJobPayload,
    deps: IndexAreaJobDeps
): Promise<void> {
    const { areaId } = payload;

    // Cancelled while still queued (before the worker ever picked it up) —
    // bail without touching status, it's already "cancelled" from the API.
    if (await deps.isCancelled(areaId)) return;

    await deps.updateAreaProgress(areaId, { status: "indexing" });

    // SE ADICIONA: Bloque try/catch global para mitigar caídas silenciosas
    try {
        // 3) Se incluye la lectura de las configuraciones de la capa gratuita y presupuesto mensual
        const [
            polygon, 
            apiKey, 
            maxConcurrentRaw, 
            pricePerImageRaw, 
            maxBudgetRaw, 
            creditRaw, 
            freeImagesRaw, 
            existingPanoHeadings
        ] = await Promise.all([
            deps.getAreaPolygon(areaId),
            deps.getSetting("GOOGLE_MAPS_API_KEY"),
            deps.getSetting("MAX_CONCURRENT_REQUESTS"),
            deps.getSetting("STREET_VIEW_PRICE_PER_IMAGE_USD"),
            deps.getSetting("MAX_MONTHLY_BUDGET_USD"),
            deps.getSetting("GOOGLE_FREE_MONTHLY_CREDIT_USD"),
            deps.getSetting("GOOGLE_FREE_MONTHLY_IMAGES"),
            deps.loadExistingPanoHeadings(),
        ]);

        if (!apiKey) {
            await deps.updateAreaProgress(areaId, { status: "failed" });
            throw new Error("GOOGLE_MAPS_API_KEY is not configured — cannot index (spec §14.5)");
        }

        const maxConcurrent = Number(maxConcurrentRaw ?? 10);
        const pricePerImageUsd = Number(pricePerImageRaw ?? 0.007);
        const maxMonthlyBudgetUsd = Number(maxBudgetRaw ?? 50);
        const creditUsd = Number(creditRaw ?? "0");
        const freeImages = Number(freeImagesRaw ?? "0");

        const lines = await deps.fetchStreetGeometry(polygon);
        const points = deps.samplePointsAlongStreets(lines, SAMPLING_SPACING_METERS);

        // SE ADICIONA: Log informativo sobre el inicio de la tarea
        console.log(`[index-area] iniciando área ${areaId} (${points.length} puntos)`);

        await deps.updateAreaProgress(areaId, { pointsEstimated: points.length });

        // 4 & 7) Validación de presupuesto considerando costes netos de la capa gratuita (Out-of-Pocket)
        const projectedGross = projectedCostUsd(points.length, STREET_VIEW_HEADINGS.length, pricePerImageUsd);
        const monthSpendUsd = await deps.getMonthlySpendUsd();
        const freeUsd = freeAllowanceUsd(creditUsd, freeImages, pricePerImageUsd);
        
        const net = netCostBreakdown({ monthSpendUsd, jobCostUsd: projectedGross, freeUsd });

        if (net.netMonthTotalUsd > maxMonthlyBudgetUsd) {
            await deps.updateAreaProgress(areaId, { status: "failed" });
            return;
        }

        const { captures, failedPoints, cancelled } = await deps.downloadCaptures(points, STREET_VIEW_HEADINGS, {
            apiKey,
            maxConcurrent,
            existingPanoHeadings,
            shouldCancel: () => deps.isCancelled(areaId),
        });

        const pointsCaptured = points.length - failedPoints;

        await deps.updateAreaProgress(areaId, {
            pointsCaptured,
            pointsFailed: failedPoints,
        });

        // Cancelled mid-download: leave status as "cancelled" (set by the API),
        // just persist whatever partial progress was made and stop — no failed/
        // indexed/embedding work past this point.
        if (cancelled) return;

        if (captures.length === 0) {
            await deps.updateAreaProgress(areaId, { status: "failed", pointsFailed: failedPoints });
            return;
        }

        // One more check: cancellation may have landed after the last point
        // finished but before embedding (the expensive next stage) started.
        if (await deps.isCancelled(areaId)) return;

        let embeddings: number[][];
        try {
            embeddings = await deps.embedImages(
                captures.map((c) => c.imageBase64),
                deps.inferenceBaseUrl
            );
        } catch (err) {
            // No silenciar: sin esto, un área marcada "failed" no da ninguna
            // pista de si el servicio de inferencia está caído, tardó demasiado,
            // o devolvió un error — hay que verlo en la terminal del worker.
            console.error(`[index-area] embedImages falló para el área ${areaId}:`, err);
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

        // 5) Registro del uso real efectuado en base de datos
        await deps.recordStreetViewUsage(captures.length, pricePerImageUsd);

        const actualCostUsd = captures.length * pricePerImageUsd;

        await deps.updateAreaProgress(areaId, {
            status: "indexed",
            pointsCaptured,
            pointsFailed: failedPoints,
            imagesEmbedded: inserts.length,
            actualCostUsd,
        });

        // SE ADICIONA: Log informativo sobre el éxito de la indexación
        console.log(`[index-area] área ${areaId} indexada: ${inserts.length} imágenes`);
    } catch (err) {
        // SE ADICIONA: Captura y loggea fallos imprevistos externos para evitar estados "bloqueados"
        console.error(`[index-area] el job del área ${areaId} falló inesperadamente:`, err);
        if (!(await deps.isCancelled(areaId))) {
            await deps.updateAreaProgress(areaId, { status: "failed" }).catch(() => {});
        }
    }
}