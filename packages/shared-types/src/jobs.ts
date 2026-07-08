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