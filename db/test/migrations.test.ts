// db/test/migrations.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://netryx:changeme@localhost:5432/netryx_test";

let client: Client;

beforeAll(async () => {
  client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

async function tableExists(name: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [name]
  );
  return rows[0].exists;
}

async function extensionExists(name: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = $1) AS exists`,
    [name]
  );
  return rows[0].exists;
}

describe("init migration", () => {
  it("enables vector and postgis extensions", async () => {
    expect(await extensionExists("vector")).toBe(true);
    expect(await extensionExists("postgis")).toBe(true);
  });

  it("creates all expected tables", async () => {
    const expected = [
      "areas",
      "indexed_images",
      "searches",
      "search_regions",
      "search_candidates",
      "api_usage",
      "system_settings",
    ];
    for (const table of expected) {
      expect(await tableExists(table)).toBe(true);
    }
  });

  it("enforces the unique (pano_id, heading) constraint on indexed_images", async () => {
    const { rows } = await client.query(
      `SELECT id FROM areas LIMIT 1` // sanity: areas table is queryable
    );
    expect(Array.isArray(rows)).toBe(true);

    await client.query(
      `INSERT INTO areas (id, geometry, area_km2)
       VALUES ('00000000-0000-0000-0000-000000000001',
               ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))', 4326), 1.0)`
    );
    await client.query(
      `INSERT INTO indexed_images (area_id, pano_id, heading, location)
       VALUES ('00000000-0000-0000-0000-000000000001', 'pano-1', 0,
               ST_GeogFromText('POINT(0 0)'))`
    );

    await expect(
      client.query(
        `INSERT INTO indexed_images (area_id, pano_id, heading, location)
         VALUES ('00000000-0000-0000-0000-000000000001', 'pano-1', 0,
                 ST_GeogFromText('POINT(0 0)'))`
      )
    ).rejects.toThrow(/duplicate key value/);

    // cleanup for test idempotency
    await client.query(
      `DELETE FROM areas WHERE id = '00000000-0000-0000-0000-000000000001'`
    );
  });

  it("creates the system_settings table with the __setup_completed__ convention", async () => {
    await client.query(
      `INSERT INTO system_settings (key, value, is_secret)
       VALUES ('__setup_completed__', 'false', false)
       ON CONFLICT (key) DO NOTHING`
    );
    const { rows } = await client.query(
      `SELECT value FROM system_settings WHERE key = '__setup_completed__'`
    );
    expect(rows[0].value).toBe("false");
  });

  // db/test/migrations.test.ts — reemplaza el test "adds points_failed..." por esto:

  it("adds points_failed to areas with a default of 0", async () => {
    const testId = "00000000-0000-0000-0000-000000000002";

    // Limpieza defensiva: si un run anterior falló entre el INSERT y el DELETE
    // final, esta fila quedó huérfana y choca con la PK en este run.
    await client.query(`DELETE FROM areas WHERE id = $1`, [testId]);

    try {
      await client.query(
        `INSERT INTO areas (id, geometry, area_km2)
       VALUES ($1, ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))', 4326), 1.0)`,
        [testId]
      );
      const { rows } = await client.query(
        `SELECT points_failed FROM areas WHERE id = $1`,
        [testId]
      );
      expect(rows[0].points_failed).toBe(0);
    } finally {
      await client.query(`DELETE FROM areas WHERE id = $1`, [testId]);
    }
  });

  it("adds points_failed to areas with a default of 0", async () => {
    const testId = "00000000-0000-0000-0000-000000000002";

    // Limpieza defensiva: si un run anterior falló entre el INSERT y el DELETE
    // final, esta fila quedó huérfana y choca con la PK en este run.
    await client.query(`DELETE FROM areas WHERE id = $1`, [testId]);

    try {
      await client.query(
        `INSERT INTO areas (id, geometry, area_km2)
       VALUES ($1, ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))', 4326), 1.0)`,
        [testId]
      );
      const { rows } = await client.query(
        `SELECT points_failed FROM areas WHERE id = $1`,
        [testId]
      );
      expect(rows[0].points_failed).toBe(0);
    } finally {
      await client.query(`DELETE FROM areas WHERE id = $1`, [testId]);
    }
  });
  it("does not attempt an hnsw index on indexed_images.embedding (pgvector caps hnsw at 2000 dims, embedding is 8448-d)", async () => {
    const { rows } = await client.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_indexed_images_embedding'`
    );
    expect(rows).toHaveLength(0);
  });

  it("creates indexed_points with a unique pano_id and an aggregate embedding column", async () => {
    const testArea = "00000000-0000-0000-0000-0000000000a1";
    await client.query(`DELETE FROM areas WHERE id = $1`, [testArea]);
    try {
      await client.query(
        `INSERT INTO areas (id, geometry, area_km2)
       VALUES ($1, ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))', 4326), 1.0)`,
        [testArea]
      );
      await client.query(
        `INSERT INTO indexed_points (area_id, pano_id, location, embedding)
       VALUES ($1, 'pano-agg-1', ST_GeogFromText('POINT(0.5 0.5)'), $2)`,
        [testArea, `[${new Array(8448).fill(0).join(",")}]`]
      );
      // UNIQUE(pano_id) — a second insert of the same pano must conflict
      await expect(
        client.query(
          `INSERT INTO indexed_points (area_id, pano_id, location, embedding)
         VALUES ($1, 'pano-agg-1', ST_GeogFromText('POINT(0.5 0.5)'), $2)`,
          [testArea, `[${new Array(8448).fill(0).join(",")}]`]
        )
      ).rejects.toThrow(/duplicate key|unique/i);
    } finally {
      await client.query(`DELETE FROM areas WHERE id = $1`, [testArea]);
    }
  });

  it("adds a nullable image_path to indexed_images (spec §9.3 verification needs the bytes)", async () => {
    const { rows } = await client.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
     WHERE table_name = 'indexed_images' AND column_name = 'image_path'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].is_nullable).toBe("YES");
  });
});