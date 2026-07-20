// apps/web/app/api/model-catalog/install/route.ts
import { NextResponse } from "next/server";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import type { Pool } from "pg";
import JSZip from "jszip";
import { readdir, copyFile } from "node:fs/promises";
import { decryptBuffer } from "@netryx/settings-repo";
import { listReleasesForRepo, downloadReleaseAsset } from "../../../../lib/model-catalog/github";
import {
  validateModelCatalogManifest,
  BUNDLE_CODE_ASSET_NAME,
  MODEL_CATALOG_METADATA_ASSET_NAME,
  type ModelCatalogManifest,
} from "../../../../lib/model-catalog/manifest";
import { MODEL_CATALOG_SHARED_KEY } from "../../../../lib/model-catalog/shared-key";
import { backupInferenceCode, restoreInferenceCode, persistBackup } from "../../../../lib/model-catalog/backup";
import { PREVIOUS_CODE_DIR, readUninstallMeta, writeUninstallMeta } from "../../../../lib/model-catalog/uninstall-state";
import { getSettingsRepo } from "../../../../lib/settings-repo";
import { installClassificationModel } from "../../../../lib/model-catalog/classification-models";
import { getPool } from "../../../../lib/db";
import { createJob, completeJob, failJob } from "../../../../lib/background-jobs";

interface InstallBody {
  owner?: string;
  repo?: string;
  tag?: string;
}

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

/** The actual install work for both strategies — split out of POST so it
 * can run detached from the request and be driven directly from
 * route.test.ts. `origin` is threaded through instead of derived from
 * `request.url`, since this runs after the request has already responded. */
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

export async function POST(request: Request) {
  const body = (await request.json()) as InstallBody;
  if (!body.owner || !body.repo || !body.tag) {
    return NextResponse.json({ error: "owner, repo and tag are required" }, { status: 400 });
  }

  const releases = await listReleasesForRepo(body.owner, body.repo);
  const release = releases.find((r) => r.tagName === body.tag);
  if (!release) {
    return NextResponse.json({ error: "release not found" }, { status: 404 });
  }

  const metadataAsset = release.assets.find((a) => a.name === MODEL_CATALOG_METADATA_ASSET_NAME);
  if (!metadataAsset) {
    return NextResponse.json({ error: "release is missing expected assets" }, { status: 400 });
  }

  const metadataBytes = await downloadReleaseAsset(metadataAsset.url);
  const manifest = validateModelCatalogManifest(
    JSON.parse(decryptBuffer(metadataBytes, MODEL_CATALOG_SHARED_KEY).toString("utf8"))
  );

  if (manifest.kind !== "generic-classifier") {
    const codeAsset = release.assets.find((a) => a.name === BUNDLE_CODE_ASSET_NAME);
    if (!codeAsset) {
      return NextResponse.json({ error: "release is missing expected assets" }, { status: 400 });
    }
  }

  const pool = getPool();
  const label =
    manifest.kind === "generic-classifier" ? `${manifest.modelId} v${manifest.version}` : `Lumi Preview v${manifest.version}`;
  const jobId = await createJob(pool, "model-install", label);

  const codeAssetUrl =
    manifest.kind === "generic-classifier"
      ? undefined
      : release.assets.find((a) => a.name === BUNDLE_CODE_ASSET_NAME)?.url;
  const origin = new URL(request.url).origin;
  void runModelInstallJob(pool, jobId, { manifest, codeAssetUrl, origin });

  return NextResponse.json({ jobId }, { status: 202 });
}