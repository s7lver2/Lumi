// apps/web/lib/search/refine-retrieval.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { expandRegionCandidates } from "./refine-retrieval";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("expandRegionCandidates", () => {
  const pool = new Pool({ connectionString: url });
  const areaId = "00000000-0000-0000-0000-0000000000d1";
  const searchId = "00000000-0000-0000-0000-0000000000d2";
  let regionId = "";

  beforeAll(async () => {
    await pool.query(`DELETE FROM areas WHERE id = $1`, [areaId]);
    await pool.query(`DELETE FROM searches WHERE id = $1`, [searchId]);
    await pool.query(
      `INSERT INTO areas (id, geometry, area_km2)
       VALUES ($1, ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))',4326),1.0)`,
      [areaId]
    );
    // "member" was clustered into this region as a Pass-1 candidate; "nearby"
    // sits well within the same 150m radius but was NEVER retrieved as a
    // candidate (e.g. a different, unrelated pano indexed by an overlapping
    // area) — expandRegionCandidates must not pull it in just because it's
    // geographically close.
    await pool.query(
      `INSERT INTO indexed_images (area_id, pano_id, heading, location, embedding, image_path, embedded_at)
       VALUES ($1,'member',0, ST_GeogFromText('POINT(0.5 0.5)'), $2, '/imgs/member_0.jpg', now()),
              ($1,'nearby',0, ST_GeogFromText('POINT(0.5001 0.5)'), $2, '/imgs/nearby_0.jpg', now())`,
      [areaId, `[${new Array(8448).fill(0).join(",")}]`]
    );
    await pool.query(
      `INSERT INTO searches (id, query_image_path) VALUES ($1, '/tmp/q.jpg')`,
      [searchId]
    );
    const r = await pool.query(
      `INSERT INTO search_regions (search_id, centroid, radius_m, aggregate_score, candidate_count)
       VALUES ($1, ST_GeogFromText('POINT(0.5 0.5)'), 150, 0.9, 1) RETURNING id`,
      [searchId]
    );
    regionId = r.rows[0].id;
    const memberImage = await pool.query(`SELECT id FROM indexed_images WHERE pano_id = 'member'`);
    await pool.query(
      `INSERT INTO search_candidates (search_id, region_id, indexed_image_id, similarity_score, rank)
       VALUES ($1, $2, $3, 0.9, 1)`,
      [searchId, regionId, memberImage.rows[0].id]
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM areas WHERE id = $1`, [areaId]);
    await pool.query(`DELETE FROM searches WHERE id = $1`, [searchId]);
    await pool.end();
  });

  it("returns only the region's actual persisted candidates, not every nearby image", async () => {
    const rows = await expandRegionCandidates(pool, regionId);
    const panos = rows.map((r) => r.panoId);
    expect(panos).toContain("member");
    expect(panos).not.toContain("nearby");
    expect(rows.find((r) => r.panoId === "member")!.imagePath).toBe("/imgs/member_0.jpg");
  });
});