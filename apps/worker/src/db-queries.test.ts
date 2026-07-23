// apps/worker/src/db-queries.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { getPendingEmbedImages, updateImageEmbeddings } from "./db-queries";

const connectionString =
  process.env.TEST_DATABASE_URL ?? "postgres://netryx:changeme@localhost:5432/netryx_test";
const pool = new Pool({ connectionString });

const AREA_ID = "00000000-0000-0000-0000-0000000000a1";

// indexed_images.embedding is a fixed vector(8448) column (db/migrations/
// 1720400000000_init.js) — the plan's own test fixture used 2-element toy
// vectors, which postgres rejects ("expected 8448 dimensions, not 2").
const EMBEDDING_DIM = 8448;
function fakeEmbeddingLiteral(fill: number): string {
  return `[${Array(EMBEDDING_DIM).fill(fill).join(",")}]`;
}
function fakeEmbeddingArray(fill: number): number[] {
  return Array(EMBEDDING_DIM).fill(fill);
}

beforeEach(async () => {
  await pool.query("DELETE FROM indexed_images WHERE area_id = $1", [AREA_ID]);
  await pool.query("DELETE FROM areas WHERE id = $1", [AREA_ID]);
  await pool.query(
    `INSERT INTO areas (id, geometry, area_km2) VALUES ($1, ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))', 4326), 1)`,
    [AREA_ID]
  );
  await pool.query(
    `INSERT INTO indexed_images (area_id, pano_id, heading, location, embedding, image_path)
     VALUES
       ($1, 'pending1', 0, ST_GeogFromText('POINT(0 0)'), NULL, '/tmp/pending1_0.jpg'),
       ($1, 'pending2', 90, ST_GeogFromText('POINT(0 0)'), NULL, NULL),
       ($1, 'already-embedded', 0, ST_GeogFromText('POINT(0 0)'), $2, '/tmp/already_0.jpg')`,
    [AREA_ID, fakeEmbeddingLiteral(0.1)]
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM indexed_images WHERE area_id = $1", [AREA_ID]);
  await pool.query("DELETE FROM areas WHERE id = $1", [AREA_ID]);
  await pool.end();
});

describe("getPendingEmbedImages", () => {
  it("returns only rows with embedding IS NULL AND image_path IS NOT NULL", async () => {
    const pending = await getPendingEmbedImages(pool, AREA_ID);
    expect(pending).toHaveLength(1);
    expect(pending[0].imagePath).toBe("/tmp/pending1_0.jpg");
  });
});

describe("updateImageEmbeddings", () => {
  it("writes the embedding for the given row ids", async () => {
    const [pending] = await getPendingEmbedImages(pool, AREA_ID);
    await updateImageEmbeddings(pool, [{ id: pending.id, embedding: fakeEmbeddingArray(0.5) }], "lumi-preview");

    const { rows } = await pool.query("SELECT embedding::text FROM indexed_images WHERE id = $1", [pending.id]);
    expect(rows[0].embedding).toBe(fakeEmbeddingLiteral(0.5));
  });
});
