``ts
// apps/web/lib/settings/db-backup.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("backupDatabaseToJson", () => {
  it("writes one JSON file covering every application table", async () => {
    const { backupDatabaseToJson, APPLICATION_TABLES } = await import("./db-backup");
    const { writeFile, mkdir } = await import("node:fs/promises");

    const query = vi.fn(async (sql: string) => {
      const table = sql.match(/FROM (\w+)/)?.[1];
      return { rows: [{ id: `${table}-row-1` }] };
    });
    const pool = { query } as any;

    const path = await backupDatabaseToJson(pool);

    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining("db-backups"), { recursive: true });
    expect(path).toContain("db-backups");
    expect(query).toHaveBeenCalledTimes(APPLICATION_TABLES.length);

    const written = JSON.parse((writeFile as any).mock.calls[0][1] as string);
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
});