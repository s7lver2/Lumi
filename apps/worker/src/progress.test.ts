// apps/worker/src/progress.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { updateAreaProgress, loadExistingPanoHeadings } from "./progress";

const connectionString =
  process.env.TEST_DATABASE_URL ?? "postgres://netryx:changeme@localhost:5432/netryx_test";
const pool = new Pool({ connectionString });
const AREA_ID = "00000000-0000-0000-0000-0000000000aa";

beforeEach(async () => {
  await pool.query("DELETE FROM indexed_images");
  await pool.query("DELETE FROM areas");
  await pool.query(
    `INSERT INTO areas (id, geometry, area_km2) VALUES ($1, ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))', 4326), 1.0)`,
    [AREA_ID]
  );
});

afterAll(async () => {
  await pool.end();
});

describe("updateAreaProgress", () => {
  it("updates only the provided columns", async () => {
    await updateAreaProgress(pool, AREA_ID, { status: "indexing", pointsEstimated: 500 });
    const { rows } = await pool.query("SELECT status, points_estimated, points_captured FROM areas WHERE id = $1", [AREA_ID]);
    expect(rows[0].status).toBe("indexing");
    expect(rows[0].points_estimated).toBe(500);
    expect(rows[0].points_captured).toBe(0); // untouched

    await updateAreaProgress(pool, AREA_ID, { pointsCaptured: 42, imagesEmbedded: 40 });
    const { rows: rows2 } = await pool.query(
      "SELECT status, points_captured, images_embedded FROM areas WHERE id = $1",
      [AREA_ID]
    );
    expect(rows2[0].status).toBe("indexing"); // untouched by the second call
    expect(rows2[0].points_captured).toBe(42);
    expect(rows2[0].images_embedded).toBe(40);
  });
});

describe("loadExistingPanoHeadings", () => {
  it("returns pano_id:heading pairs already present across all areas", async () => {
    await pool.query(
      `INSERT INTO indexed_images (area_id, pano_id, heading, location)
       VALUES ($1, 'pano-existing', 90, ST_GeogFromText('POINT(0 0)'))`,
      [AREA_ID]
    );

    const set = await loadExistingPanoHeadings(pool);
    expect(set.has("pano-existing:90")).toBe(true);
    expect(set.has("pano-existing:0")).toBe(false);
  });
});