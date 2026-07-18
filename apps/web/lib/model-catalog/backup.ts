// apps/web/lib/model-catalog/backup.ts
import { mkdtemp, mkdir, readdir, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, dirname } from "node:path";

const EXCLUDED_DIRS = new Set(["venv", "data", "__pycache__", ".pytest_cache", ".catalog-backup"]);

async function copyTree(fromDir: string, toDir: string, root: string): Promise<void> {
  const entries = await readdir(fromDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      await copyTree(join(fromDir, entry.name), toDir, root);
      continue;
    }
    if (!entry.name.endsWith(".py") && entry.name !== "requirements.txt") continue;
    const srcPath = join(fromDir, entry.name);
    const relPath = relative(root, srcPath);
    const destPath = join(toDir, relPath);
    await mkdir(dirname(destPath), { recursive: true });
    await copyFile(srcPath, destPath);
  }
}

/** Copies the current .py files + requirements.txt into a fresh temp
 * backup directory, before a catalog install overwrites them — never
 * touches venv/ or data/ (spec's install-flow "backup" step). Returns the
 * backup directory's path, needed later by restoreInferenceCode if the
 * new version's restart fails. */
export async function backupInferenceCode(inferenceDir: string): Promise<string> {
  const backupDir = await mkdtemp(join(tmpdir(), "lumi-catalog-backup-"));
  await copyTree(inferenceDir, backupDir, inferenceDir);
  return backupDir;
}

/** Restores files from a prior backupInferenceCode() call back over
 * inferenceDir — used when a newly-installed version's restart never
 * comes back healthy. */
export async function restoreInferenceCode(inferenceDir: string, backupDir: string): Promise<void> {
  await copyTree(backupDir, inferenceDir, backupDir);
}

/** Copies backupDir's contents into a fixed, persistent destDir (replacing
 * whatever was there) — used to keep the pre-install snapshot around after
 * the request that made it ends, so a later uninstall can restore it. */
export async function persistBackup(backupDir: string, destDir: string): Promise<void> {
  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });
  await copyTree(backupDir, destDir, backupDir);
}
