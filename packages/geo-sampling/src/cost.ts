// packages/geo-sampling/src/cost.ts

/**
 * Spec §12.1: nº puntos × nº headings × precio por imagen, menos las
 * imágenes ya indexadas de un área solapada anterior (reusableImages —
 * ver apps/web/lib/reuse-estimate.ts). reusableImages es una ESTIMACIÓN
 * (cuenta puntos ya indexados dentro del polígono, no un match exacto
 * pano/heading, que no se conoce hasta la llamada a metadata en el job real).
 */
export function estimateIndexingCostUsd(
  pointsEstimated: number,
  headingsCount: number,
  pricePerImageUsd: number,
  reusableImages = 0
): number {
  const potentialImages = pointsEstimated * headingsCount;
  const billableImages = Math.max(0, potentialImages - reusableImages);
  return billableImages * pricePerImageUsd;
}

/** Spec §12.2 MAX_AREA_KM2 — rejected in the UI/API before touching the backend job. */
export function assertAreaWithinSizeLimit(areaKm2: number, maxAreaKm2: number): void {
  if (areaKm2 > maxAreaKm2) {
    throw new Error(
      `Area of ${areaKm2} km² exceeds the configured limit of ${maxAreaKm2} km²`
    );
  }
}