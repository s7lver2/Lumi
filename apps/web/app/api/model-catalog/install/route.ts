// apps/web/app/api/model-catalog/install/route.ts
import { NextResponse } from "next/server";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import JSZip from "jszip";
import { readdir, copyFile } from "node:fs/promises";
import { decryptBuffer } from "@netryx/settings-repo";
import { listReleasesForRepo, downloadReleaseAsset } from "../../../../lib/model-catalog/github";
import { validateModelCatalogManifest, BUNDLE_CODE_ASSET_NAME, MODEL_CATALOG_METADATA_ASSET_NAME } from "../../../../lib/model-catalog/manifest";
import { MODEL_CATALOG_SHARED_KEY } from "../../../../lib/model-catalog/shared-key";
import { backupInferenceCode, restoreInferenceCode } from "../../../../lib/model-catalog/backup";

interface InstallBody {
  owner?: string;
  repo?: string;
  tag?: string;
}

// process.cwd() is apps/web (the Next.js app root) — two levels up reaches
// the repo root, where services/inference actually lives.
const INFERENCE_DIR = resolve(process.cwd(), "..", "..", "services", "inference");
const INFERENCE_SERVICE_URL = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";

// Must match backupInferenceCode's own filter (apps/web/lib/model-catalog/
// backup.ts) exactly — the backup only ever captures .py/requirements.txt,
// so copying anything else from the release zip over INFERENCE_DIR would
// leave a file restoreInferenceCode has no way to roll back on failure.
function isManagedInferenceFile(name: string): boolean {
  return name.endsWith(".py") || name === "requirements.txt";
}

// Overridable via env (not a public setting) so tests can shrink a 60s real
// wait down to milliseconds without fighting fake timers against the many
// non-timer awaits (fetch, fs) elsewhere in this route.
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
  const codeAsset = release.assets.find((a) => a.name === BUNDLE_CODE_ASSET_NAME);
  if (!metadataAsset || !codeAsset) {
    return NextResponse.json({ error: "release is missing expected assets" }, { status: 400 });
  }

  const metadataBytes = await downloadReleaseAsset(metadataAsset.url);
  const manifest = validateModelCatalogManifest(
    JSON.parse(decryptBuffer(metadataBytes, MODEL_CATALOG_SHARED_KEY).toString("utf8"))
  );

  const codeBytes = await downloadReleaseAsset(codeAsset.url);
  const decrypted = decryptBuffer(codeBytes, MODEL_CATALOG_SHARED_KEY);

  const origin = new URL(request.url).origin;
  const stagingDir = await mkdtemp(join(tmpdir(), "lumi-catalog-install-"));
  let backupDir: string | null = null;

  try {
    const zip = await JSZip.loadAsync(decrypted);
    for (const [relPath, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      // Reject anything the release zip shouldn't contain BEFORE touching
      // the staging dir or INFERENCE_DIR — backupInferenceCode only ever
      // backs up .py/requirements.txt, so a release smuggling any other
      // file type would leave something restoreInferenceCode can't roll
      // back on a failed install.
      const baseName = relPath.split("/").pop() ?? relPath;
      if (!isManagedInferenceFile(baseName)) {
        throw new Error(`Unexpected file in release bundle (only .py and requirements.txt are allowed): ${relPath}`);
      }
      const destPath = join(stagingDir, relPath);
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, await entry.async("nodebuffer"));
    }

    backupDir = await backupInferenceCode(INFERENCE_DIR);

    // Copy staged files over the real inference dir — same file-type scope
    // as backupInferenceCode (enforced above), so restoreInferenceCode can
    // always undo exactly what this loop wrote.
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

    // Restart the inference service — reuses the low-VRAM-mode epic's
    // restart mechanism (POST /api/setup/run/restart-inference).
    const restartRes = await fetch(`${origin}/api/setup/run/restart-inference`, { method: "POST" });
    void restartRes; // SSE stream — this route just waits for real readiness below, not the stream's own "done" event.

    const ready = await waitForInferenceReady();
    if (!ready) {
      await restoreInferenceCode(INFERENCE_DIR, backupDir);
      await fetch(`${origin}/api/setup/run/restart-inference`, { method: "POST" });
      const restoredReady = await waitForInferenceReady();
      return NextResponse.json(
        {
          ok: false,
          error: `No se pudo aplicar la versión ${manifest.version} — se restauró la versión anterior`,
          restoredVersion: true,
          restoredHealthy: restoredReady,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, version: manifest.version });
  } catch (err) {
    if (backupDir) await restoreInferenceCode(INFERENCE_DIR, backupDir);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
    if (backupDir) await rm(backupDir, { recursive: true, force: true });
  }
}
