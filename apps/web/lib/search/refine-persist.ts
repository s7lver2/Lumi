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

interface ExistingRow {
  id: string;
  indexed_image_id: string;
  pano_id: string;
  heading: number;
  lat: number;
  lng: number;
  similarity_score: string;
  verification_score: string | null;
}

/**
 * Ranks and upserts the ENTIRE region's candidates, not just whatever was
 * just verified (spec: docs/superpowers/specs/2026-07-21-results-widgets-
 * popup-and-per-candidate-refine-design.md) — a naive "rank only args.scored"
 * approach is only correct when args.scored happens to cover the whole
 * region (true for a whole-zone refine, false for a single-candidate
 * refine, where a lone re-verified candidate would otherwise always land
 * at rank 1 regardless of how it compares to the rest). Fetches the
 * region's current rows, overlays args.scored's fresh verification scores
 * on top (fresh score wins for those; everyone else keeps their existing
 * similarity/verification score), ranks the union by
 * verificationScore ?? similarityScore, and writes rank/status for every
 * region row — but only overwrites verification_score for rows actually
 * in args.scored this call. A candidate becomes "confirmed" only at rank 1
 * AND with a real (non-null) verification score clearing confirmThreshold
 * — sorting to the top on similarity alone (never verified) doesn't
 * confirm it.
 *
 * When args.scored already covers the whole region (today's only call
 * pattern before per-candidate refine existed), the "existing rows not in
 * scored" set is empty and this behaves identically to the old
 * scored-only ranking.
 */
export async function persistRefine(
  pool: Pool,
  args: PersistRefineArgs
): Promise<SearchCandidate[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: existingRows } = await client.query<ExistingRow>(
      `SELECT sc.id, sc.indexed_image_id, sc.similarity_score, sc.verification_score,
              img.pano_id, img.heading,
              ST_Y(img.location::geometry) AS lat, ST_X(img.location::geometry) AS lng
       FROM search_candidates sc
       JOIN indexed_images img ON img.id = sc.indexed_image_id
       WHERE sc.region_id = $1`,
      [args.regionId]
    );

    const scoredByImageId = new Map(args.scored.map((c) => [c.indexedImageId, c]));

    interface Merged {
      indexedImageId: string;
      panoId: string;
      heading: number;
      lat: number;
      lng: number;
      similarityScore: number;
      verificationScore: number | null;
      justScored: boolean;
    }

    const merged: Merged[] = existingRows.map((r) => {
      const fresh = scoredByImageId.get(r.indexed_image_id);
      return {
        indexedImageId: r.indexed_image_id,
        panoId: r.pano_id,
        heading: r.heading,
        lat: Number(r.lat),
        lng: Number(r.lng),
        similarityScore: fresh ? fresh.similarityScore : Number(r.similarity_score),
        verificationScore: fresh ? fresh.verificationScore : r.verification_score === null ? null : Number(r.verification_score),
        justScored: Boolean(fresh),
      };
    });

    // A scored candidate with no existing search_candidates row yet (can
    // happen for a brand-new candidate never persisted before) — add it too.
    for (const c of args.scored) {
      if (!merged.some((m) => m.indexedImageId === c.indexedImageId)) {
        merged.push({
          indexedImageId: c.indexedImageId,
          panoId: c.panoId,
          heading: c.heading,
          lat: c.lat,
          lng: c.lng,
          similarityScore: c.similarityScore,
          verificationScore: c.verificationScore,
          justScored: true,
        });
      }
    }

    const ranked = [...merged].sort(
      (a, b) => (b.verificationScore ?? b.similarityScore) - (a.verificationScore ?? a.similarityScore)
    );

    const out: SearchCandidate[] = [];

    for (let i = 0; i < ranked.length; i++) {
      const c = ranked[i];
      const rank = i + 1;
      const status =
        rank === 1 && c.verificationScore !== null && c.verificationScore >= args.confirmThreshold
          ? "confirmed"
          : "unreviewed";

      const existing = await client.query(
        `SELECT id FROM search_candidates WHERE search_id = $1 AND indexed_image_id = $2`,
        [args.searchId, c.indexedImageId]
      );

      let id: string;
      if (existing.rows.length > 0) {
        id = existing.rows[0].id;
        if (c.justScored) {
          await client.query(
            `UPDATE search_candidates
               SET region_id = $1, similarity_score = $2, verification_score = $3, rank = $4, status = $5
             WHERE id = $6`,
            [args.regionId, c.similarityScore, c.verificationScore, rank, status, id]
          );
        } else {
          await client.query(
            `UPDATE search_candidates SET rank = $1, status = $2 WHERE id = $3`,
            [rank, status, id]
          );
        }
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
