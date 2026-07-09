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
    // one image ~0m from centroid (inside), one ~1km away (outside a 150m radius)
    await pool.query(
      `INSERT INTO indexed_images (area_id, pano_id, heading, location, embedding, image_path, embedded_at)
       VALUES ($1,'near',0, ST_GeogFromText('POINT(0.5 0.5)'), $2, '/imgs/near_0.jpg', now()),
              ($1,'far',0,  ST_GeogFromText('POINT(0.52 0.5)'), $2, '/imgs/far_0.jpg', now())`,
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
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM areas WHERE id = $1`, [areaId]);
    await pool.query(`DELETE FROM searches WHERE id = $1`, [searchId]);
    await pool.end();
  });

  it("returns only images within the region radius, with their image paths", async () => {
    const rows = await expandRegionCandidates(pool, regionId);
    const panos = rows.map((r) => r.panoId);
    expect(panos).toContain("near");
    expect(panos).not.toContain("far");
    expect(rows.find((r) => r.panoId === "near")!.imagePath).toBe("/imgs/near_0.jpg");
  });
});