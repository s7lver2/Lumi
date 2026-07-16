// apps/web/lib/model-catalog/benchmark.ts
import type { Pool } from "pg";
import { DEFAULT_TOP_K, DEFAULT_REGION_RADIUS_M } from "@netryx/shared-types";
import { clusterCandidates } from "../search/cluster";
import type { RetrievedCandidate } from "../search/retrieval";
import type { ModelCatalogBenchmark } from "./manifest";

export const BENCHMARK_ACCURACY_THRESHOLD = 0.7;
export const BENCHMARK_DISTANCE_THRESHOLD_M = 50;
const DEFAULT_REFERENCE_SET_SIZE = 20;

export interface BenchmarkCase {
  indexedImageId: string;
  imagePath: string;
  trueLat: number;
  trueLng: number;
}

export interface BenchmarkDeps {
  readImageBase64: (imagePath: string) => Promise<string>;
  embedQuery: (imageBase64: string) => Promise<number[]>;
  retrieve: (embedding: number[], excludeIndexedImageId: string) => Promise<RetrievedCandidate[]>;
}

/**
 * Deterministically selects up to `count` already-indexed images from THIS
 * install's own data as the benchmark reference set (spec's "fixed
 * reference set" — interpreted as "stable across runs on this install",
 * not a hardcoded fixture, since every self-hosted install has entirely
 * different indexed data). Ordered by created_at/id so re-running the
 * benchmark later (as long as the underlying rows haven't changed) picks
 * the same cases.
 */
export async function buildReferenceSet(pool: Pool, count: number = DEFAULT_REFERENCE_SET_SIZE): Promise<BenchmarkCase[]> {
  const { rows } = await pool.query(
    `SELECT id, image_path, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
     FROM indexed_images
     WHERE embedding IS NOT NULL AND image_path IS NOT NULL
     ORDER BY created_at, id
     LIMIT $1`,
    [count]
  );
  return rows.map((r) => ({
    indexedImageId: r.id,
    imagePath: r.image_path,
    trueLat: Number(r.lat),
    trueLng: Number(r.lng),
  }));
}

function haversineDistanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Scores each reference case using real embed + retrieve + cluster
 * (leave-one-out via retrieve's excludeIndexedImageId), comparing the top
 * clustered region's centroid to the case's known-true location. Uses
 * retrieval+clustering only, not a full refine pass, to keep this
 * runnable as part of the publish flow itself (RoMa verification is
 * 10-25s/candidate — too slow to run per benchmark case here); this can
 * be extended to include refine later without changing the pass/fail
 * mechanism (spec's benchmark section, implementation note).
 */
export async function runBenchmark(cases: BenchmarkCase[], deps: BenchmarkDeps): Promise<ModelCatalogBenchmark> {
  let withinThreshold = 0;
  let totalDistance = 0;

  for (const c of cases) {
    const imageBase64 = await deps.readImageBase64(c.imagePath);
    const embedding = await deps.embedQuery(imageBase64);
    const candidates = await deps.retrieve(embedding, c.indexedImageId);
    const regions = clusterCandidates(candidates, DEFAULT_REGION_RADIUS_M);
    const top = regions[0];
    const distance = top ? haversineDistanceM(c.trueLat, c.trueLng, top.centroid.lat, top.centroid.lng) : Infinity;
    if (distance <= BENCHMARK_DISTANCE_THRESHOLD_M) withinThreshold++;
    totalDistance += distance;
  }

  return {
    accuracyWithin50m: cases.length > 0 ? withinThreshold / cases.length : 0,
    avgDistanceM: cases.length > 0 ? totalDistance / cases.length : 0,
    sampleCount: cases.length,
    ranAt: new Date().toISOString(),
  };
}

export function passesBenchmarkThreshold(result: ModelCatalogBenchmark): boolean {
  return result.accuracyWithin50m >= BENCHMARK_ACCURACY_THRESHOLD;
}
