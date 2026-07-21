// apps/web/lib/search/persist.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { persistSearch } from "./persist";
import type { RetrievedCandidate } from "./retrieval";
import type { ClusteredRegion } from "./cluster";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("persistSearch", () => {
  const pool = new Pool({ connectionString: url });
  const areaId = "00000000-0000-0000-0000-0000000000c1";
  let imageId = "";

  beforeAll(async () => {
    await pool.query(`DELETE FROM areas WHERE id = $1`, [areaId]);
    await pool.query(
      `INSERT INTO areas (id, geometry, area_km2)
       VALUES ($1, ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))',4326), 1.0)`,
      [areaId]
    );
    const r = await pool.query(
      `INSERT INTO indexed_images (area_id, pano_id, heading, location, embedding, embedded_at)
       VALUES ($1,'pano-p',0, ST_GeogFromText('POINT(0.5 0.5)'), $2, now()) RETURNING id`,
      [areaId, `[${new Array(8448).fill(0).join(",")}]`]
    );
    imageId = r.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM areas WHERE id = $1`, [areaId]);
    await pool.end();
  });

  it("persists search, regions and candidates and returns them grouped by region", async () => {
    const candidates: RetrievedCandidate[] = [
      { indexedImageId: imageId, panoId: "pano-p", heading: 0, lat: 0.5, lng: 0.5, similarity: 0.88, embedding: [] },
    ];
    const regions: ClusteredRegion[] = [
      { centroid: { lat: 0.5, lng: 0.5 }, radiusM: 150, aggregateScore: 0.88, memberIds: [imageId] },
    ];

    const res = await persistSearch(pool, {
      queryImagePath: "/tmp/q.jpg",
      queryEmbedding: new Array(8448).fill(0),
      candidates,
      regions,
    });

    expect(res.searchId).toBeTruthy();
    expect(res.regions).toHaveLength(1);
    const regionId = res.regions[0].id;
    expect(res.candidatesByRegion[regionId]).toHaveLength(1);
    expect(res.candidatesByRegion[regionId][0].verificationScore).toBeNull();
    expect(res.candidatesByRegion[regionId][0].status).toBe("unreviewed");
    expect(res.candidatesByRegion[regionId][0].rank).toBe(1);
  });
  it("passes timeOfDay through into the response without writing it anywhere", async () => {
    const candidates: RetrievedCandidate[] = [
      { indexedImageId: imageId, panoId: "pano-p", heading: 0, lat: 0.5, lng: 0.5, similarity: 0.88, embedding: [] },
    ];
    const regions: ClusteredRegion[] = [
      { centroid: { lat: 0.5, lng: 0.5 }, radiusM: 150, aggregateScore: 0.88, memberIds: [imageId] },
    ];

    const res = await persistSearch(pool, {
      queryImagePath: "/tmp/q.jpg",
      queryEmbedding: new Array(8448).fill(0),
      candidates,
      regions,
      timeOfDay: { label: "foto tomada al mediodía", score: 0.72 },
    });

    expect(res.timeOfDay).toEqual({ label: "foto tomada al mediodía", score: 0.72 });
  });

  it("defaults timeOfDay to null when not provided", async () => {
    const res = await persistSearch(pool, {
      queryImagePath: "/tmp/q.jpg",
      queryEmbedding: new Array(8448).fill(0),
      candidates: [],
      regions: [],
    });

    expect(res.timeOfDay).toBeNull();
  });
});