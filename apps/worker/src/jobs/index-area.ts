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
    samplePointsAlongStreets: (lines: LineStringGeoJSON[], spacingMeters: number, polygon: [number, number][]) => SampledPoint[];
    loadExistingPanoHeadings: () => Promise<Set<string>>;
    downloadCaptures: (
        points: SampledPoint[],
        headings: readonly number[],
        opts: {
            apiKey: string;
            maxConcurrent: number;
            existingPanoHeadings: Set<string>;
            shouldCancel?: () => Promise<boolean> | boolean;
            onPointDone?: (done: number, total: number) => void;
        }
    ) => Promise<{ captures: StreetViewCapture[]; failedPoints: number; cancelled: boolean }>;
    embedImages: (imagesBase64: string[], inferenceBaseUrl: string) => Promise<number[][]>;
    insertIndexedImages: (areaId: string, images: IndexedImageInsert[], retrievalModelId?: string) => Promise<void>;
    updateAreaProgress: (areaId: string, update: AreaProgressUpdate) => Promise<void>;
    getSetting: (key: string) => Promise<string | null>;
    inferenceBaseUrl: string;
    insertIndexedPoints: (areaId: string, points: IndexedPointInsert[], retrievalModelId?: string) => Promise<void>;
    saveCaptureImage: (panoId: string, heading: number, base64: string) => Promise<string>;
    getMonthlySpendUsd: () => Promise<number>;
    recordStreetViewUsage: (requests: number, pricePerImageUsd: number) => Promise<void>;
    /** Cooperative cancellation: has the user cancelled this area from the UI? */
    isCancelled: (areaId: string) => Promise<boolean>;
}

const SAMPLING_SPACING_METERS = 18; // midpoint of the spec's "every ~15-20m" (spec §4 step 2)

// Embedding one giant batch (e.g. 356 images for an 89-point area) OOMs the
// CPU-bound inference service — confirmed live: "not enough memory: you
// tried to allocate 6375342080 bytes" from a single /embed call. Chunking
// keeps each request small AND, as a side effect, lets us insert rows into
// indexed_images progressively instead of all at once at the very end — so
// the map can show points appearing as they're indexed, not in one jump.
const EMBED_CHUNK_SIZE = 16;

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
        const points = deps.samplePointsAlongStreets(lines, SAMPLING_SPACING_METERS, polygon);

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

        // SE ADICIONA: Cálculo de ratio e inyección del callback en downloadCaptures
        const progressEveryN = Math.max(1, Math.floor(points.length / 50));
        const { captures, failedPoints, cancelled } = await deps.downloadCaptures(points, STREET_VIEW_HEADINGS, {
            apiKey,
            maxConcurrent,
            existingPanoHeadings,
            shouldCancel: () => deps.isCancelled(areaId),
            onPointDone: (done, total) => {
                if (done % progressEveryN === 0 || done === total) {
                    // Fire-and-forget: don't block the download loop waiting on a DB write.
                    // Caps writes at ~50 for the whole job regardless of area size.
                    deps.updateAreaProgress(areaId, { pointsCaptured: done }).catch(() => {});
                }
            },
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

        const embeddings: number[][] = [];
        const inserts: IndexedImageInsert[] = [];

        for (let start = 0; start < captures.length; start += EMBED_CHUNK_SIZE) {
            const chunk = captures.slice(start, start + EMBED_CHUNK_SIZE);
            let chunkEmbeddings: number[][];
            try {
                chunkEmbeddings = await deps.embedImages(
                    chunk.map((c) => c.imageBase64),
                    deps.inferenceBaseUrl
                );
            } catch (err) {
                // No silenciar: sin esto, un área marcada "failed" no da ninguna
                // pista de si el servicio de inferencia está caído, tardó demasiado,
                // se quedó sin memoria, o devolvió un error — hay que verlo en la
                // terminal del worker.
                console.error(`[index-area] embedImages falló para el área ${areaId}:`, err);
                await deps.updateAreaProgress(areaId, {
                    status: "failed",
                    pointsFailed: failedPoints,
                    imagesEmbedded: inserts.length,
                });
                return;
            }
            embeddings.push(...chunkEmbeddings);

            const chunkInserts: IndexedImageInsert[] = [];
            for (let i = 0; i < chunk.length; i++) {
                const capture = chunk[i];
                const imagePath = await deps.saveCaptureImage(
                    capture.panoId,
                    capture.heading,
                    capture.imageBase64
                );
                chunkInserts.push({
                    panoId: capture.panoId,
                    heading: capture.heading,
                    lat: capture.lat,
                    lng: capture.lng,
                    captureDate: capture.captureDate,
                    embedding: chunkEmbeddings[i],
                    imagePath,
                });
            }

            // Insertado lote a lote (no acumulado hasta el final): así el mapa,
            // sondeando /api/areas/:id, puede ir mostrando los puntos en cuanto
            // cada lote se escribe en vez de todos de golpe al terminar.
            await deps.insertIndexedImages(areaId, chunkInserts);
            inserts.push(...chunkInserts);

            await deps.updateAreaProgress(areaId, { imagesEmbedded: inserts.length });
        }

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