// apps/web/lib/settings/db-backup.ts
import { mkdir, writeFile } from "node:fs/promises";
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

interface TableBackup {
  table: string;
  rows: Record<string, unknown>[];
}

/** Dumps every application table to one JSON file under data/db-backups/ —
 * a safety net before a destructive reset, not a one-command restore tool.
 * Returns the absolute path written. */
export async function backupDatabaseToJson(pool: Pool): Promise<string> {
  const backup: TableBackup[] = [];
  for (const table of APPLICATION_TABLES) {
    const { rows } = await pool.query(`SELECT * FROM ${table}`);
    backup.push({ table, rows });
  }

  const dir = resolve(process.cwd(), "data", "db-backups");
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(path, JSON.stringify(backup), "utf8");
  return path;
}