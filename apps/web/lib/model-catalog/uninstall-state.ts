// apps/web/lib/model-catalog/uninstall-state.ts
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { getRepoRoot } from "../repo-root";

// This backups dir sits next to services/inference at the repo root, outside
// any single request's tmpdir, so the "previous version" snapshot survives
// across requests/restarts until the next install or a successful uninstall
// consumes it — but only if it's actually anchored to the real repo root
// (see repo-root.ts: a packaged --testing run's process.cwd() is NOT that,
// and this exact bug was confirmed live as the reason "Reinstalar Lumi
// Preview para crear un respaldo" never stuck between rebuilds).
const BACKUPS_ROOT = resolve(getRepoRoot(), ".model-catalog-backups");
export const PREVIOUS_CODE_DIR = resolve(BACKUPS_ROOT, "previous");
const META_PATH = resolve(BACKUPS_ROOT, "meta.json");

export interface UninstallMeta {
  // Label for whatever is currently installed (a manifest version, or null
  // meaning "the original state before any catalog install ever ran").
  currentVersion: string | null;
  // Label for what's captured in PREVIOUS_CODE_DIR right now — what an
  // uninstall would restore to. null means nothing to restore.
  previousVersion: string | null;
}

export async function readUninstallMeta(): Promise<UninstallMeta> {
  try {
    const raw = await readFile(META_PATH, "utf8");
    return JSON.parse(raw) as UninstallMeta;
  } catch {
    return { currentVersion: null, previousVersion: null };
  }
}

export async function writeUninstallMeta(meta: UninstallMeta): Promise<void> {
  await mkdir(dirname(META_PATH), { recursive: true });
  await writeFile(META_PATH, JSON.stringify(meta), "utf8");
}

export async function clearPreviousBackup(): Promise<void> {
  await rm(PREVIOUS_CODE_DIR, { recursive: true, force: true });
}
