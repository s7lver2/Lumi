// apps/web/lib/search/run-refine.ts
import type { RefineResponse, SearchCandidate } from "@netryx/shared-types";
import type { RegionCandidate } from "./refine-retrieval";
import type { VerifyResult } from "../verify-client";
import type { ScoredCandidate, PersistRefineArgs } from "./refine-persist";

export interface RunRefineInput {
  searchId: string;
  regionId: string;
}

export interface RunRefineDeps {
  confirmThreshold: number;
  getQueryImagePath: (searchId: string) => Promise<string>;
  expandRegion: (regionId: string) => Promise<RegionCandidate[]>;
  readImage: (path: string) => Promise<string | null>;
  verify: (queryBase64: string, candidateBase64: string[]) => Promise<VerifyResult[]>;
  persist: (args: PersistRefineArgs) => Promise<SearchCandidate[]>;
}

/** Pass 2 orchestration (spec §9.3). Missing-image candidates are skipped, not dropped silently. */
export async function runRefine(deps: RunRefineDeps, input: RunRefineInput): Promise<RefineResponse> {
  const queryPath = await deps.getQueryImagePath(input.searchId);
  const queryBase64 = await deps.readImage(queryPath);
  if (queryBase64 === null) {
    throw new Error(`Query image missing for search ${input.searchId} at ${queryPath}`);
  }

  const region = await deps.expandRegion(input.regionId);

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

  const results = await deps.verify(
    queryBase64,
    present.map((p) => p.base64)
  );

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