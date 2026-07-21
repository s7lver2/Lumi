// apps/web/lib/search/run-search.ts
import type { SearchResponse } from "@netryx/shared-types";
import type { RetrievedCandidate } from "./retrieval";
import type { ClusteredRegion } from "./cluster";
import type { PersistSearchArgs } from "./persist";

export interface RunSearchInput {
  imageBase64: string;
  imageBytes: Buffer;
  imageExt: string;
}

export interface RunSearchDeps {
  newSearchId: () => string;
  embedQuery: (imageBase64: string) => Promise<number[]>;
  retrieve: (queryEmbedding: number[]) => Promise<RetrievedCandidate[]>;
  rerank: (queryEmbedding: number[], candidates: RetrievedCandidate[]) => RetrievedCandidate[];
  cluster: (candidates: RetrievedCandidate[]) => ClusteredRegion[];
  saveImage: (searchId: string, bytes: Buffer, ext: string) => Promise<string>;
  persist: (args: PersistSearchArgs) => Promise<SearchResponse>;
  /** Optional — omitted entirely when no active model serves the
   * time_of_day facet. Must never reject (the caller building this dep is
   * responsible for catching its own errors and resolving null instead —
   * see estimate/route.ts) so runSearch itself stays simple. Runs
   * concurrently with embedQuery via Promise.all, not sequentially, since
   * both only need the same query image and neither depends on the
   * other's result. */
  classifyTimeOfDay?: (imageBase64: string) => Promise<{ label: string; score: number } | null>;
}

/** Pass 1 orchestration (spec §9.2). Deps are injected so HTTP glue stays thin. */
export async function runSearch(deps: RunSearchDeps, input: RunSearchInput): Promise<SearchResponse> {
  const searchId = deps.newSearchId();
  const [queryEmbedding, timeOfDay] = await Promise.all([
    deps.embedQuery(input.imageBase64),
    deps.classifyTimeOfDay ? deps.classifyTimeOfDay(input.imageBase64) : Promise.resolve(null),
  ]);
  const retrieved = await deps.retrieve(queryEmbedding);
  const reranked = deps.rerank(queryEmbedding, retrieved);
  const regions = deps.cluster(reranked);
  const queryImagePath = await deps.saveImage(searchId, input.imageBytes, input.imageExt);
  return deps.persist({ queryImagePath, queryEmbedding, candidates: reranked, regions, timeOfDay });
}