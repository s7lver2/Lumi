// apps/web/lib/search/retrieval.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { retrieveCandidates } from "./retrieval";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip; // skip cleanly when no test DB is configured

d("retrieveCandidates", () => {
  const pool = new Pool({ connectionString: url });
  const areaId = "00000000-0000-0000-0000-0000000000b1";

  function vec(first: number): string {
    const arr = new Array(8448).fill(0);
    arr[0] = first;
    return `[${arr.join(",")}]`;
  }

  beforeAll(async () => {
    await pool.query(`DELETE FROM areas WHERE id = $1`, [areaId]);
    await pool.query(
      `INSERT INTO areas (id, geometry, area_km2)
       VALUES ($1, ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))',4326), 1.0)`,
      [areaId]
    );
    // image A points the same way as the query (first dim = 1) -> high similarity
    // image B is orthogonal (first dim = 0, another dim set) -> low similarity
    await pool.query(
      `INSERT INTO indexed_images (area_id, pano_id, heading, location, embedding, embedded_at)
       VALUES ($1,'pano-a',0, ST_GeogFromText('POINT(0.5 0.5)'), $2, now()),
              ($1,'pano-b',0, ST_GeogFromText('POINT(0.6 0.6)'), $3, now())`,
      [areaId, vec(1), `[${[0, 1, ...new Array(8446).fill(0)].join(",")}]`]
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM areas WHERE id = $1`, [areaId]);
    await pool.end();
  });

  it("returns candidates ordered by cosine similarity, best first", async () => {
    const query = new Array(8448).fill(0);
    query[0] = 1;
    const results = await retrieveCandidates(pool, query, 10);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].panoId).toBe("pano-a");
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
    expect(results[0].embedding).toHaveLength(8448);
  });
});