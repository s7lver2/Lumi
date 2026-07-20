// apps/web/lib/settings/db-backup.ts
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";

/** Fixed, hardcoded — deliberately not discovered via information_schema at
 * request time, which would silently start touching PostGIS's tiger/
 * topology reference tables or a future migrations-bookkeeping table.
 * Adding a new application table later means updating this array
 * explicitly (spec: docs/superpowers/specs/2026-07-20-settings-db-reset-
 * design.md). */
export const APPLICATION_TABLES = [
  "api_usage",
  "areas",
  "indexed_images",
  "indexed_points",
  "installed_classification_models",
  "search_batches",
  "search_candidates",
  "search_regions",
  "searches",
  "system_settings",
  "worker_heartbeat",
] as const;

async function writeChunk(stream: NodeJS.WritableStream, chunk: string): Promise<void> {
  if (!stream.write(chunk)) {
    await new Promise<void>((res) => stream.once("drain", res));
  }
}

/** Dumps every application table to one JSON file under data/db-backups/ —
 * a safety net before a destructive reset, not a one-command restore tool.
 * Streams the file directly to disk, JSON.stringify-ing one row at a time,
 * rather than collecting every table into one in-memory array and calling
 * JSON.stringify() once over the whole thing: this app's core data is
 * vector(8448) embeddings, and a single JSON.stringify() over a few
 * thousand of those rows exceeds V8's max string length (confirmed live:
 * indexed_images alone, 5173 rows, threw "Invalid string length" from one
 * JSON.stringify(rows) call — pg_stat_user_tables' row-count estimate is
 * stale until an ANALYZE runs, so a quick row-count check looked empty
 * when the table actually held real data). The output is still one valid
 * JSON file shaped as [{ table, rows }, ...] — only how it's built
 * changed. Returns the absolute path written. */
export async function backupDatabaseToJson(pool: Pool): Promise<string> {
  const dir = resolve(process.cwd(), "data", "db-backups");
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

  const stream = createWriteStream(path, { encoding: "utf8" });
  const done = new Promise<void>((res, rej) => {
    stream.on("finish", res);
    stream.on("error", rej);
  });

  await writeChunk(stream, "[");
  for (let t = 0; t < APPLICATION_TABLES.length; t++) {
    const table = APPLICATION_TABLES[t];
    const { rows } = await pool.query(`SELECT * FROM ${table}`);
    await writeChunk(stream, `${t > 0 ? "," : ""}{"table":${JSON.stringify(table)},"rows":[`);
    for (let i = 0; i < rows.length; i++) {
      await writeChunk(stream, `${i > 0 ? "," : ""}${JSON.stringify(rows[i])}`);
    }
    await writeChunk(stream, "]}");
  }
  await writeChunk(stream, "]");
  stream.end();
  await done;

  return path;
}