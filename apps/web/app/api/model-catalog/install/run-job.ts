// apps/web/app/api/model-catalog/install/run-job.ts
import { mkdtemp, mkdir, writeFile, rm, readdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import type { Pool } from "pg";
import JSZip from "jszip";
import { decryptBuffer } from "@netryx/settings-repo";
import { downloadReleaseAsset } from "../../../../lib/model-catalog/github";
import { type ModelCatalogManifest } from "../../../../lib/model-catalog/manifest";
import { MODEL_CATALOG_SHARED_KEY } from "../../../../lib/model-catalog/shared-key";
import { backupInferenceCode, restoreInferenceCode, persistBackup } from "../../../../lib/model-catalog/backup";
import { PREVIOUS_CODE_DIR, readUninstallMeta, writeUninstallMeta } from "../../../../lib/model-catalog/uninstall-state";
import { getSettingsRepo } from "../../../../lib/settings-repo";
import { installClassificationModel } from "../../../../lib/model-catalog/classification-models";
import { completeJob, failJob } from "../../../../lib/background-jobs";

const INFERENCE_DIR = resolve(process.cwd(), "..", "..", "services", "inference");
const INFERENCE_SERVICE_URL = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";

function isManagedInferenceFile(name: string): boolean {
  return name.endsWith(".py") || name === "requirements.txt";
}

const READY_POLL_TIMEOUT_MS = Number(process.env.MODEL_CATALOG_READY_TIMEOUT_MS ?? 60_000);
const READY_POLL_INTERVAL_MS = Number(process.env.MODEL_CATALOG_READY_POLL_INTERVAL_MS ?? 1_000);

async function waitForInferenceReady(timeoutMs: number = READY_POLL_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${INFERENCE_SERVICE_URL}/docs`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL_MS));
  }
  return false;
}

/** The actual install work for both strategies — split out of route.ts
 * (not just POST) because Next.js's App Router only allows route files to
 * export HTTP method handlers and a small config allowlist; any other
 * export fails `next build`'s route type-checking. `origin` is threaded
 * through instead of derived from `request.url`, since this runs after the
 * request has already responded. Runs detached and is driven directly
 * from run-job.test.ts. */
export async function runModelInstallJob(
  pool: Pool,
  jobId: string,
  args: { manifest: ModelCatalogManifest; codeAssetUrl: string | undefined; origin: string }
): Promise<void> {
  const { manifest } = args;

  if (manifest.kind === "generic-classifier") {
    try {
      await installClassificationModel(pool, manifest);
      await completeJob(pool, jobId, { ok: true, modelId: manifest.modelId, version: manifest.version });
    } catch (err) {
      await failJob(pool, jobId, err instanceof Error ? err.message : String(err));
    }
    return;
  }

  if (!args.codeAssetUrl) {
    await failJob(pool, jobId, "release is missing expected assets");
    return;
  }

  const codeBytes = await downloadReleaseAsset(args.codeAssetUrl);
  const decrypted = decryptBuffer(codeBytes, MODEL_CATALOG_SHARED_KEY);

  const stagingDir = await mkdtemp(join(tmpdir(), "lumi-catalog-install-"));
  let backupDir: string | null = null;

  try {
    const zip = await JSZip.loadAsync(decrypted);
    for (const [relPath, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const baseName = relPath.split("/").pop() ?? relPath;
      if (!isManagedInferenceFile(baseName)) {
        throw new Error(`Unexpected file in release bundle (only .py and requirements.txt are allowed): ${relPath}`);
      }
      const destPath = join(stagingDir, relPath);
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, await entry.async("nodebuffer"));
    }

    backupDir = await backupInferenceCode(INFERENCE_DIR);

    async function copyStagedTree(fromDir: string): Promise<void> {
      const entries = await readdir(fromDir, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = join(fromDir, entry.name);
        if (entry.isDirectory()) {
          await copyStagedTree(srcPath);
          continue;
        }
        const relPath = srcPath.slice(stagingDir.length + 1);
        const destPath = join(INFERENCE_DIR, relPath);
        await mkdir(dirname(destPath), { recursive: true });
        await copyFile(srcPath, destPath);
      }
    }
    await copyStagedTree(stagingDir);

    const restartRes = await fetch(`${args.origin}/api/setup/run/restart-inference`, { method: "POST" });
    void restartRes;

    const ready = await waitForInferenceReady();
    if (!ready) {
      await restoreInferenceCode(INFERENCE_DIR, backupDir);
      await fetch(`${args.origin}/api/setup/run/restart-inference`, { method: "POST" });
      const restoredReady = await waitForInferenceReady();
      await failJob(
        pool,
        jobId,
        `No se pudo aplicar la versión ${manifest.version} — se restauró la versión anterior${restoredReady ? "" : " (el servicio de inferencia tampoco volvió a responder tras restaurar)"}`
      );
      return;
    }

    const priorMeta = await readUninstallMeta();
    await persistBackup(backupDir, PREVIOUS_CODE_DIR);
    await writeUninstallMeta({ currentVersion: manifest.version, previousVersion: priorMeta.currentVersion });

    const settingsRepo = getSettingsRepo();
    await settingsRepo.setSetting("RETRIEVAL_MODEL", manifest.bundleId, false);
    if (manifest.verificationModelId) {
      await settingsRepo.setSetting("VERIFICATION_MODEL", manifest.verificationModelId, false);
    }

    await completeJob(pool, jobId, { ok: true, version: manifest.version });
  } catch (err) {
    if (backupDir) await restoreInferenceCode(INFERENCE_DIR, backupDir);
    await failJob(pool, jobId, err instanceof Error ? err.message : String(err));
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
    if (backupDir) await rm(backupDir, { recursive: true, force: true });
  }
}
