// apps/web/lib/settings/db-backup.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

function makeFakeStream() {
  const emitter = new EventEmitter() as any;
  emitter.chunks = [] as string[];
  emitter.write = (chunk: string) => {
    emitter.chunks.push(chunk);
    return true;
  };
  emitter.end = () => {
    queueMicrotask(() => emitter.emit("finish"));
    return emitter;
  };
  return emitter as NodeJS.WritableStream & { chunks: string[] };
}

let fakeStream: ReturnType<typeof makeFakeStream>;

vi.mock("node:fs", () => ({
  createWriteStream: vi.fn(() => fakeStream),
}));

beforeEach(() => {
  vi.clearAllMocks();
  fakeStream = makeFakeStream();
});

describe("backupDatabaseToJson", () => {
  it("writes one JSON file covering every application table", async () => {
    const { backupDatabaseToJson, APPLICATION_TABLES } = await import("./db-backup");
    const { mkdir } = await import("node:fs/promises");

    const query = vi.fn(async (sql: string) => {
      const table = sql.match(/FROM (\w+)/)?.[1];
      return { rows: [{ id: `${table}-row-1` }] };
    });
    const pool = { query } as any;

    const path = await backupDatabaseToJson(pool);

    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining("db-backups"), { recursive: true });
    expect(path).toContain("db-backups");
    expect(query).toHaveBeenCalledTimes(APPLICATION_TABLES.length);

    const written = JSON.parse(fakeStream.chunks.join(""));
    expect(written).toHaveLength(APPLICATION_TABLES.length);
    for (const table of APPLICATION_TABLES) {
      const entry = written.find((e: any) => e.table === table);
      expect(entry).toBeDefined();
      expect(entry.rows).toEqual([{ id: `${table}-row-1` }]);
    }
  });

  it("returns an absolute path ending in .json", async () => {
    const { backupDatabaseToJson } = await import("./db-backup");
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) } as any;

    const path = await backupDatabaseToJson(pool);

    expect(path.endsWith(".json")).toBe(true);
    expect(path.startsWith("/")).toBe(true);
  });

  it("streams thousands of large embedding rows without ever building one oversized string", async () => {
    // Regression test for a real bug: JSON.stringify() over a full table's
    // rows in one call throws "Invalid string length" once a table has
    // enough rows — confirmed live against the real dev DB, where
    // indexed_images (5173 rows of vector(8448) embeddings) blew past
    // V8's max string length from a single JSON.stringify(rows) call.
    // This simulates that shape (thousands of rows, each a large
    // embedding array) to prove the streaming rewrite never assembles
    // more than one row's JSON at a time.
    const { backupDatabaseToJson, APPLICATION_TABLES } = await import("./db-backup");
    const bigEmbedding = new Array(8448).fill(0.123456789);
    const bigTableRowCount = 6000;
    const query = vi.fn(async (sql: string) => {
      const table = sql.match(/FROM (\w+)/)?.[1];
      if (table === "indexed_images") {
        return { rows: Array.from({ length: bigTableRowCount }, (_, i) => ({ id: i, embedding: bigEmbedding })) };
      }
      return { rows: [] };
    });
    const pool = { query } as any;

    const path = await backupDatabaseToJson(pool);
    expect(path).toContain("db-backups");

    // Deliberately do NOT reassemble the chunks into one string here —
    // doing so reproduces the exact bug this test guards against (joining
    // ~6000 embedding-sized chunks throws "Invalid string length" itself).
    // Assert the property that actually matters instead: no single write()
    // call ever carries more than one row's worth of JSON.
    for (const chunk of fakeStream.chunks) {
      expect(chunk.length).toBeLessThan(1_000_000);
    }
    const rowChunks = fakeStream.chunks.filter((c) => c.includes('"id":'));
    expect(rowChunks).toHaveLength(bigTableRowCount);
  }, 20_000);
});
