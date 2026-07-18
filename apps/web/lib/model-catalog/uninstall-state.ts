// apps/web/lib/model-catalog/uninstall-state.ts
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";

// process.cwd() is apps/web — two levels up reaches the repo root, where
// services/inference lives (see install/route.ts's INFERENCE_DIR). This
// backups dir sits next to it, outside any single request's tmpdir, so the
// "previous version" snapshot survives across requests/restarts until the
// next install or a successful uninstall consumes it.
const BACKUPS_ROOT = resolve(process.cwd(), "..", "..", ".model-catalog-backups");
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
