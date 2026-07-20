// packages/shared-types/src/search.ts

/** Spec §9.2 — top-k candidates pulled by cosine before clustering. */
export const DEFAULT_TOP_K = 50;

/** Fraction (0..1) of the top-1 candidate's similarity below which a Pass-1
 * candidate is dropped — without this, top-k retrieval returns k candidates
 * regardless of how dissimilar they are (a sparse/small index can surface
 * 2-8% "matches" alongside the real one). A fixed absolute cutoff doesn't
 * work here: MegaLoc's cosine similarity isn't on a stable scale across
 * searches (confirmed live — one search's best real match scored 8.9%,
 * another search's best match scored 97%), so the floor is relative to each
 * search's own top score instead. */
export const DEFAULT_RELATIVE_SIMILARITY_FLOOR = 0.4;

/** Radius (metres) within which candidates are grouped into one region (spec §9.2 clustering). */
export const DEFAULT_REGION_RADIUS_M = 150;

/** How many top candidates feed the query-expansion re-ranking (Lumi Preview, spec §15.1). */
export const DEFAULT_QUERY_EXPANSION_SIZE = 5;

/** One clustered region returned by Pass 1 — mirrors the search_regions row (spec §11, §13). */
export interface SearchRegion {
  id: string;
  centroid: { lat: number; lng: number };
  radiusM: number;
  aggregateScore: number;
  candidateCount: number;
}

/** One ranked candidate image within a region (spec §11, §13). verificationScore is null until Pass 2. */
export interface SearchCandidate {
  id: string;
  regionId: string | null;
  indexedImageId: string;
  panoId: string;
  heading: number;
  lat: number;
  lng: number;
  similarityScore: number;
  verificationScore: number | null;
  rank: number;
  status: "unreviewed" | "confirmed";
}

/** Response body of POST /api/search (Pass 1). */
export interface SearchResponse {
  searchId: string;
  regions: SearchRegion[];
  candidatesByRegion: Record<string, SearchCandidate[]>;
}

/** Verification score at/above which the top candidate auto-confirms (spec §9.3). */
export const DEFAULT_CONFIRM_THRESHOLD = 0.5;

/** Body of POST /api/search/:searchId/refine (Pass 2). */
/** Body of POST /api/models/{modelId}/refine (Pass 2) — searchId moved into
 * the body once the URL became per-model instead of per-search. */
export interface RefineRequest {
  searchId: string;
  regionId: string;
}

/** Response of the refine endpoint — candidates re-ranked by verification score. */
export interface RefineResponse {
  searchId: string;
  regionId: string;
  candidates: SearchCandidate[];
}