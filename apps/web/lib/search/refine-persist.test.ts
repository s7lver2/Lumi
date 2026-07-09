// apps/web/lib/search/refine-persist.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { persistRefine } from "./refine-persist";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("persistRefine", () => {
  const pool = new Pool({ connectionString: url });
  const areaId = "00000000-0000-0000-0000-0000000000e1";
  const searchId = "00000000-0000-0000-0000-0000000000e2";
  let regionId = "";
  let imgHigh = "";
  let imgLow = "";

  beforeAll(async () => {
    await pool.query(`DELETE FROM areas WHERE id = $1`, [areaId]);
    await pool.query(`DELETE FROM searches WHERE id = $1`, [searchId]);
    await pool.query(
      `INSERT INTO areas (id, geometry, area_km2)
       VALUES ($1, ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))',4326),1.0)`,
      [areaId]
    );
    const a = await pool.query(
      `INSERT INTO indexed_images (area_id, pano_id, heading, location, embedding, image_path, embedded_at)
       VALUES ($1,'hi',0, ST_GeogFromText('POINT(0.5 0.5)'), $2,'/i/hi.jpg',now()) RETURNING id`,
      [areaId, `[${new Array(8448).fill(0).join(",")}]`]
    );
    imgHigh = a.rows[0].id;
    const b = await pool.query(
      `INSERT INTO indexed_images (area_id, pano_id, heading, location, embedding, image_path, embedded_at)
       VALUES ($1,'lo',0, ST_GeogFromText('POINT(0.5 0.5)'), $2,'/i/lo.jpg',now()) RETURNING id`,
      [areaId, `[${new Array(8448).fill(0).join(",")}]`]
    );
    imgLow = b.rows[0].id;
    await pool.query(`INSERT INTO searches (id, query_image_path) VALUES ($1,'/tmp/q.jpg')`, [searchId]);
    const r = await pool.query(
      `INSERT INTO search_regions (search_id, centroid, radius_m, aggregate_score, candidate_count)
       VALUES ($1, ST_GeogFromText('POINT(0.5 0.5)'),150,0.9,2) RETURNING id`,
      [searchId]
    );
    regionId = r.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM areas WHERE id = $1`, [areaId]);
    await pool.query(`DELETE FROM searches WHERE id = $1`, [searchId]);
    await pool.end();
  });

  it("ranks by verification score and confirms the top when it clears the threshold", async () => {
    const out = await persistRefine(pool, {
      searchId,
      regionId,
      confirmThreshold: 0.5,
      scored: [
        { indexedImageId: imgLow, panoId: "lo", heading: 0, lat: 0.5, lng: 0.5, similarityScore: 0.7, verificationScore: 0.2 },
        { indexedImageId: imgHigh, panoId: "hi", heading: 0, lat: 0.5, lng: 0.5, similarityScore: 0.6, verificationScore: 0.9 },
      ],
    });

    expect(out[0].indexedImageId).toBe(imgHigh);
    expect(out[0].rank).toBe(1);
    expect(out[0].status).toBe("confirmed");
    expect(out[1].status).toBe("unreviewed");

    // persisted, not just returned
    const { rows } = await pool.query(
      `SELECT verification_score, status, rank FROM search_candidates
       WHERE search_id = $1 AND indexed_image_id = $2`,
      [searchId, imgHigh]
    );
    expect(Number(rows[0].verification_score)).toBeCloseTo(0.9, 5);
    expect(rows[0].status).toBe("confirmed");
  });
});