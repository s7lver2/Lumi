// apps/worker/src/aggregate.ts
import type { StreetViewCapture } from "@netryx/shared-types";

export interface IndexedPointInsert {
  panoId: string;
  lat: number;
  lng: number;
  embedding: number[];
}

/**
 * Groups embeddings by pano and returns the L2-normalized mean descriptor per
 * pano — Lumi Preview's multi-heading aggregation (spec §15.1). `embeddings[i]`
 * must correspond to `captures[i]`.
 */
export function aggregatePanoDescriptors(
  captures: StreetViewCapture[],
  embeddings: number[][]
): IndexedPointInsert[] {
  const byPano = new Map<string, { lat: number; lng: number; vectors: number[][] }>();

  captures.forEach((capture, i) => {
    const entry = byPano.get(capture.panoId);
    if (entry) {
      entry.vectors.push(embeddings[i]);
    } else {
      byPano.set(capture.panoId, {
        lat: capture.lat,
        lng: capture.lng,
        vectors: [embeddings[i]],
      });
    }
  });

  const points: IndexedPointInsert[] = [];
  for (const [panoId, { lat, lng, vectors }] of byPano) {
    const dim = vectors[0].length;
    const mean = new Array(dim).fill(0);
    for (const v of vectors) for (let d = 0; d < dim; d++) mean[d] += v[d];
    for (let d = 0; d < dim; d++) mean[d] /= vectors.length;
    const norm = Math.hypot(...mean);
    const embedding = norm > 0 ? mean.map((x) => x / norm) : mean;
    points.push({ panoId, lat, lng, embedding });
  }
  return points;
}