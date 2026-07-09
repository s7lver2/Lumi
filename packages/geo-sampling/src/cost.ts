// packages/geo-sampling/src/cost.ts

/** Spec §12.1: nº puntos × nº headings × precio por imagen. */
export function estimateIndexingCostUsd(
  pointsEstimated: number,
  headingsCount: number,
  pricePerImageUsd: number
): number {
  return pointsEstimated * headingsCount * pricePerImageUsd;
}

/** Spec §12.2 MAX_AREA_KM2 — rejected in the UI/API before touching the backend job. */
export function assertAreaWithinSizeLimit(areaKm2: number, maxAreaKm2: number): void {
  if (areaKm2 > maxAreaKm2) {
    throw new Error(
      `Area of ${areaKm2} km² exceeds the configured limit of ${maxAreaKm2} km²`
    );
  }
}