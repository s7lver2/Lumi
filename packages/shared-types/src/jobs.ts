// packages/shared-types/src/jobs.ts
export const INDEX_AREA_JOB_NAME = "index-area";

/** 0°=N, 90°=E, 180°=S, 270°=W — one capture per cardinal direction per point (spec §4). */
export const STREET_VIEW_HEADINGS: readonly number[] = [0, 90, 180, 270];

export interface IndexAreaJobPayload {
  areaId: string;
}

export interface SampledPoint {
  lat: number;
  lng: number;
}

export interface StreetViewCapture {
  panoId: string;
  heading: number;
  lat: number;
  lng: number;
  /** Street View's own capture date, "YYYY-MM" format, or null if unavailable. */
  captureDate: string | null;
  imageBase64: string;
}

/** Fills in embeddings for indexed_images rows that already have an image
 * on disk but embedding IS NULL — used after installing a dataset release
 * built with a different model (spec's "Completing embeddings after a
 * mismatched install" section). Deliberately NOT the same job as
 * index-area: that job re-walks street geometry and re-attempts Street
 * View downloads, using a global (pano_id, heading) dedup that would just
 * SKIP these already-captured rows, embedding included. */
export const EMBED_PENDING_IMAGES_JOB_NAME = "embed-pending-images";

export interface EmbedPendingImagesJobPayload {
  areaId: string;
}

/** One batch image-analysis run against the in-memory library (spec §2.4)
 * — deliberately its own job, not a variant of embed-pending-images: it
 * analyzes ad-hoc library images against a chosen model rather than
 * embedding pending indexed_images rows. */
export const ANALYZE_IMAGE_BATCH_JOB_NAME = "analyze-image-batch";

export interface AnalyzeImageBatchJobPayload {
  batchId: string;
  imageIds: string[];
  modelId: string;
}