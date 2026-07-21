// apps/web/lib/search/run-refine.ts
import type { RefineResponse, SearchCandidate } from "@netryx/shared-types";
import type { RegionCandidate } from "./refine-retrieval";
import type { VerifyResult } from "../verify-client";
import type { ScoredCandidate, PersistRefineArgs } from "./refine-persist";

export interface RunRefineInput {
  searchId: string;
  regionId: string;
  candidateId?: string;
}

export interface RunRefineDeps {
  confirmThreshold: number;
  getQueryImagePath: (searchId: string) => Promise<string>;
  expandRegion: (regionId: string) => Promise<RegionCandidate[]>;
  /** Only needed when input.candidateId is present. */
  expandOneCandidate?: (candidateId: string) => Promise<RegionCandidate | null>;
  readImage: (path: string) => Promise<string | null>;
  verify: (queryBase64: string, candidateBase64: string[]) => Promise<VerifyResult[]>;
  persist: (args: PersistRefineArgs) => Promise<SearchCandidate[]>;
  // Called after each candidate finishes verifying (verified count, total),
  // so a caller (the refine route's SSE stream) can report live progress and
  // an ETA to the frontend. Optional so existing tests/callers that don't
  // care about progress don't need to pass a no-op.
  onProgress?: (verified: number, total: number) => void;
}

// RoMa-based verification is dense pairwise matching — MUCH more expensive
// per image than a Lumi Preview embedding. Sending all of a region's
// candidates (seen live: 44) in one /verify call meant one blocking request
// that could run for many minutes with zero feedback, reading as "colgado".
// Chunk size is 1, not a batch — services/inference/main.py's own /verify
// handler already loops over candidates ONE AT A TIME internally regardless
// of how many are sent per request (no batched/parallel matching happens
// there), so a bigger chunk buys nothing but fewer, longer-hanging HTTP
// calls. Chunking by 1 costs nothing extra in total processing time and
// gives onProgress a real per-candidate checkpoint to report to the
// frontend (spec: live progress + ETA during refine).
const VERIFY_CHUNK_SIZE = 1;

/** Pass 2 orchestration (spec §9.3). Missing-image candidates are skipped, not dropped silently. */
export async function runRefine(deps: RunRefineDeps, input: RunRefineInput): Promise<RefineResponse> {
  const queryPath = await deps.getQueryImagePath(input.searchId);
  const queryBase64 = await deps.readImage(queryPath);
  if (queryBase64 === null) {
    throw new Error(`Query image missing for search ${input.searchId} at ${queryPath}`);
  }

  const region: RegionCandidate[] = await (async () => {
    const candidateId = input.candidateId;
    if (!candidateId) {
      return deps.expandRegion(input.regionId);
    }
    if (!deps.expandOneCandidate) {
      throw new Error("expandOneCandidate dep is required when input.candidateId is set");
    }
    const one = await deps.expandOneCandidate(candidateId);
    return one ? [one] : [];
  })();

  // Pair each candidate with its image; keep only those whose image is present.
  const present: { candidate: RegionCandidate; base64: string }[] = [];
  let skipped = 0;
  for (const candidate of region) {
    const base64 = candidate.imagePath ? await deps.readImage(candidate.imagePath) : null;
    if (base64 === null) {
      skipped += 1;
      continue;
    }
    present.push({ candidate, base64 });
  }

  if (skipped > 0) {
    // Visible, not silent (Global Constraints): areas indexed before Pass 2 have no image.
    console.warn(`runRefine: skipped ${skipped} candidate(s) with no stored image (reindex to verify).`);
  }

  if (present.length === 0) {
    const candidates = await deps.persist({
      searchId: input.searchId,
      regionId: input.regionId,
      scored: [],
      confirmThreshold: deps.confirmThreshold,
    });
    return { searchId: input.searchId, regionId: input.regionId, candidates };
  }

  console.log(`[run-refine] verificando ${present.length} candidatos para la región ${input.regionId} en lotes de ${VERIFY_CHUNK_SIZE}`);
  deps.onProgress?.(0, present.length);

  const results: Awaited<ReturnType<RunRefineDeps["verify"]>> = [];
  let failedAfterRetry = 0;
  for (let start = 0; start < present.length; start += VERIFY_CHUNK_SIZE) {
    const chunk = present.slice(start, start + VERIFY_CHUNK_SIZE);
    let chunkResults: VerifyResult[];
    try {
      chunkResults = await deps.verify(queryBase64, chunk.map((p) => p.base64));
    } catch (err) {
      // One slow/failed candidate (a transient GPU hiccup, a request that
      // legitimately exceeds verify-client.ts's own safety-net timeout, a
      // brief inference-service hiccup) used to throw here and abort the
      // ENTIRE refine — confirmed live: bigger regions (more candidates =
      // more chances one of them fails) sometimes aborted the whole batch
      // with nothing persisted, even though most candidates had already
      // verified fine. Retry once (a genuine transient blip usually
      // clears), then fall back to an unverified (score 0) result instead
      // of losing everyone else's already-completed work.
      console.warn(
        `[run-refine] candidato falló al verificar, reintentando una vez: ${err instanceof Error ? err.message : String(err)}`
      );
      try {
        chunkResults = await deps.verify(queryBase64, chunk.map((p) => p.base64));
      } catch (retryErr) {
        failedAfterRetry += chunk.length;
        console.warn(
          `[run-refine] candidato falló de nuevo, se guarda sin puntuación: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`
        );
        chunkResults = chunk.map(() => ({ inliers: 0, reprojError: Infinity, score: 0 }));
      }
    }
    results.push(...chunkResults);
    console.log(`[run-refine] verificados ${results.length}/${present.length}`);
    deps.onProgress?.(results.length, present.length);
  }
  if (failedAfterRetry > 0) {
    console.warn(`[run-refine] ${failedAfterRetry} candidato(s) no se pudieron verificar tras reintentar.`);
  }

  const scored: ScoredCandidate[] = present.map((p, i) => ({
    indexedImageId: p.candidate.indexedImageId,
    panoId: p.candidate.panoId,
    heading: p.candidate.heading,
    lat: p.candidate.lat,
    lng: p.candidate.lng,
    similarityScore: 0, // Pass 2 ranks by verification; similarity already stored from Pass 1
    verificationScore: results[i].score,
  }));

  const candidates = await deps.persist({
    searchId: input.searchId,
    regionId: input.regionId,
    scored,
    confirmThreshold: deps.confirmThreshold,
  });
  return { searchId: input.searchId, regionId: input.regionId, candidates };
}