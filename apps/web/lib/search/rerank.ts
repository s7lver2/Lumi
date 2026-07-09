// apps/web/lib/search/rerank.ts
import type { RetrievedCandidate } from "./retrieval";

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(dot(v, v));
  return norm > 0 ? v.map((x) => x / norm) : v;
}

/**
 * Query expansion (Lumi Preview, spec §15.1): expand the query with the mean of
 * its top-m candidate embeddings, then re-score all candidates against the
 * expanded, re-normalized query. Embeddings are already L2-normalized, so a dot
 * product is cosine similarity.
 */
export function queryExpansionRerank(
  queryEmbedding: number[],
  candidates: RetrievedCandidate[],
  expansionSize: number
): RetrievedCandidate[] {
  if (candidates.length === 0) return [];

  const dim = queryEmbedding.length;
  const topM = candidates.slice(0, Math.min(expansionSize, candidates.length));

  const expanded = queryEmbedding.slice();
  for (const c of topM) for (let d = 0; d < dim; d++) expanded[d] += c.embedding[d];
  for (let d = 0; d < dim; d++) expanded[d] /= topM.length + 1;
  const q = normalize(expanded);

  return candidates
    .map((c) => ({ ...c, similarity: dot(q, c.embedding) }))
    .sort((a, b) => b.similarity - a.similarity);
}