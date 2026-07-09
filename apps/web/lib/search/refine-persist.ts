// apps/web/lib/search/refine-persist.ts
import type { Pool } from "pg";
import type { SearchCandidate } from "@netryx/shared-types";

export interface ScoredCandidate {
  indexedImageId: string;
  panoId: string;
  heading: number;
  lat: number;
  lng: number;
  similarityScore: number;
  verificationScore: number;
}

export interface PersistRefineArgs {
  searchId: string;
  regionId: string;
  scored: ScoredCandidate[];
  confirmThreshold: number;
}

/**
 * Upserts each region candidate's verification score + street-level rank onto
 * search_candidates and confirms the top one if it clears the threshold
 * (spec §9.3 step 6). Ranked by verification score, best first.
 */
export async function persistRefine(
  pool: Pool,
  args: PersistRefineArgs
): Promise<SearchCandidate[]> {
  const ranked = [...args.scored].sort((a, b) => b.verificationScore - a.verificationScore);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out: SearchCandidate[] = [];

    for (let i = 0; i < ranked.length; i++) {
      const c = ranked[i];
      const rank = i + 1;
      const status =
        rank === 1 && c.verificationScore >= args.confirmThreshold ? "confirmed" : "unreviewed";

      // A candidate may or may not already exist from Pass 1 — upsert by (search, image).
      const existing = await client.query(
        `SELECT id FROM search_candidates WHERE search_id = $1 AND indexed_image_id = $2`,
        [args.searchId, c.indexedImageId]
      );

      let id: string;
      if (existing.rows.length > 0) {
        id = existing.rows[0].id;
        await client.query(
          `UPDATE search_candidates
             SET region_id = $1, similarity_score = $2, verification_score = $3, rank = $4, status = $5
           WHERE id = $6`,
          [args.regionId, c.similarityScore, c.verificationScore, rank, status, id]
        );
      } else {
        const inserted = await client.query(
          `INSERT INTO search_candidates
             (search_id, region_id, indexed_image_id, similarity_score, verification_score, rank, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [args.searchId, args.regionId, c.indexedImageId, c.similarityScore, c.verificationScore, rank, status]
        );
        id = inserted.rows[0].id;
      }

      out.push({
        id,
        regionId: args.regionId,
        indexedImageId: c.indexedImageId,
        panoId: c.panoId,
        heading: c.heading,
        lat: c.lat,
        lng: c.lng,
        similarityScore: c.similarityScore,
        verificationScore: c.verificationScore,
        rank,
        status,
      });
    }

    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}