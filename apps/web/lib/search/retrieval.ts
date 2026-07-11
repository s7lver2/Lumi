// apps/web/lib/search/retrieval.ts
import type { Pool } from "pg";

export interface RetrievedCandidate {
  indexedImageId: string;
  panoId: string;
  heading: number;
  lat: number;
  lng: number;
  similarity: number;
  embedding: number[];
}

function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

/** Parses pgvector's text output ("[1,2,3]") back into a number[]. */
function parseVector(text: string): number[] {
  return text.slice(1, -1).split(",").map(Number);
}

/**
 * Top-k cosine retrieval over per-heading images, unioned with per-pano
 * aggregate hits expanded to their headings (Lumi Preview, spec §15.1, §9.2).
 * `1 - (embedding <=> q)` converts pgvector cosine distance to similarity.
 */
export async function retrieveCandidates(
  pool: Pool,
  queryEmbedding: number[],
  k: number
): Promise<RetrievedCandidate[]> {
  const q = toVectorLiteral(queryEmbedding);

  const perHeading = await pool.query(
    `SELECT id, pano_id, heading,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng,
            1 - (embedding <=> $1) AS similarity,
            embedding::text AS embedding_text
     FROM indexed_images
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1
     LIMIT $2`,
    [q, k]
  );

  // Aggregate recall: nearest panos, expanded to all their per-heading images.
  const aggregate = await pool.query(
    `SELECT img.id, img.pano_id, img.heading,
            ST_Y(img.location::geometry) AS lat,
            ST_X(img.location::geometry) AS lng,
            1 - (img.embedding <=> $1) AS similarity,
            img.embedding::text AS embedding_text
     FROM (
       SELECT pano_id FROM indexed_points
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1
       LIMIT $2
     ) AS near_panos
     JOIN indexed_images img ON img.pano_id = near_panos.pano_id
     WHERE img.embedding IS NOT NULL`,
    [q, k]
  );

  // Dedup by panoId, not by indexedImageId: the aggregate query above
  // deliberately expands each matched pano to ALL of its heading images
  // (spec intent: broaden recall around a promising point), but that means
  // up to 4 near-duplicate "candidates" for the exact same physical
  // location/panorama, just facing different directions. Surfacing all 4 as
  // separate results inflates the candidate count (confirmed live: a single
  // query photo produced 222 "resultados", most of them duplicate headings
  // of the same handful of real locations) without adding any real location
  // diversity. Keeping only the best-scoring heading per pano collapses
  // those duplicates down to one candidate per physical place.
  const byPano = new Map<string, RetrievedCandidate>();
  for (const r of [...perHeading.rows, ...aggregate.rows]) {
    const candidate: RetrievedCandidate = {
      indexedImageId: r.id,
      panoId: r.pano_id,
      heading: r.heading,
      lat: Number(r.lat),
      lng: Number(r.lng),
      similarity: Number(r.similarity),
      embedding: parseVector(r.embedding_text),
    };
    const existing = byPano.get(candidate.panoId);
    if (!existing || candidate.similarity > existing.similarity) {
      byPano.set(candidate.panoId, candidate);
    }
  }

  return [...byPano.values()].sort((a, b) => b.similarity - a.similarity);
}
