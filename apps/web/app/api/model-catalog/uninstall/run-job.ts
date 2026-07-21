// apps/web/app/api/model-catalog/uninstall/run-job.ts
import { resolve } from "node:path";
import type { Pool } from "pg";
import { restoreInferenceCode } from "../../../../lib/model-catalog/backup";
import {
  PREVIOUS_CODE_DIR,
  writeUninstallMeta,
  clearPreviousBackup,
  type UninstallMeta,
} from "../../../../lib/model-catalog/uninstall-state";
import { uninstallClassificationModel } from "../../../../lib/model-catalog/classification-models";
import { completeJob, failJob } from "../../../../lib/background-jobs";
import { getRepoRoot } from "../../../../lib/repo-root";

// Must be the real repo checkout, not process.cwd()'s "../.." — see
// repo-root.ts for why a packaged --testing run's cwd doesn't give that.
const INFERENCE_DIR = resolve(getRepoRoot(), "services", "inference");
const INFERENCE_SERVICE_URL = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";
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

/** The actual uninstall work for both strategies — split out of route.ts
 * (not just POST) because Next.js's App Router only allows route files to
 * export HTTP method handlers and a small config allowlist; any other
 * export fails `next build`'s route type-checking. `meta` is read once by
 * POST (it already needs it for the "nothing installed" 400 check) and
 * threaded through rather than re-read here, avoiding a redundant read and
 * a theoretical TOCTOU gap between the check and the restore. Runs
 * detached and is driven directly from run-job.test.ts. */
export async function runModelUninstallJob(
  pool: Pool,
  jobId: string,
  args: { modelId: string | undefined; meta: UninstallMeta; origin: string }
): Promise<void> {
  if (args.modelId) {
    try {
      const { restoredVersion } = await uninstallClassificationModel(pool, args.modelId);
      await completeJob(pool, jobId, { ok: true, version: restoredVersion });
    } catch (err) {
      await failJob(pool, jobId, err instanceof Error ? err.message : String(err));
    }
    return;
  }

  try {
    await restoreInferenceCode(INFERENCE_DIR, PREVIOUS_CODE_DIR);

    const restartRes = await fetch(`${args.origin}/api/setup/run/restart-inference`, { method: "POST" });
    void restartRes;

    const ready = await waitForInferenceReady();
    if (!ready) {
      await failJob(pool, jobId, "Inference engine readiness check failed after restoring the previous version");
      return;
    }

    await writeUninstallMeta({ currentVersion: args.meta.previousVersion, previousVersion: null });
    await clearPreviousBackup();

    await completeJob(pool, jobId, { ok: true, version: args.meta.previousVersion });
  } catch (err) {
    await failJob(pool, jobId, err instanceof Error ? err.message : String(err));
  }
}
