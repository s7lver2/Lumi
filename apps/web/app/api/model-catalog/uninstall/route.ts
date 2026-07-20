// apps/web/app/api/model-catalog/uninstall/route.ts
import { NextResponse } from "next/server";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { restoreInferenceCode } from "../../../../lib/model-catalog/backup";
import { PREVIOUS_CODE_DIR, readUninstallMeta, writeUninstallMeta, clearPreviousBackup } from "../../../../lib/model-catalog/uninstall-state";
import { uninstallClassificationModel, getClassificationModelHistory } from "../../../../lib/model-catalog/classification-models";
import { getPool } from "../../../../lib/db";
import { createJob, completeJob, failJob } from "../../../../lib/background-jobs";

const INFERENCE_DIR = resolve(process.cwd(), "..", "..", "services", "inference");
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

export async function GET(request: Request) {
  const modelId = new URL(request.url).searchParams.get("modelId");
  if (modelId) {
    const history = await getClassificationModelHistory(getPool(), modelId);
    return NextResponse.json(history);
  }

  const meta = await readUninstallMeta();
  return NextResponse.json({ available: meta.previousVersion !== null || meta.currentVersion !== null, previousVersion: meta.previousVersion });
}

/** The actual uninstall work for both strategies — split out of POST so it
 * can run detached from the request and be driven directly from
 * route.test.ts. */
export async function runModelUninstallJob(
  pool: Pool,
  jobId: string,
  args: { modelId: string | undefined; origin: string }
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
    const meta = await readUninstallMeta();
    await restoreInferenceCode(INFERENCE_DIR, PREVIOUS_CODE_DIR);

    const restartRes = await fetch(`${args.origin}/api/setup/run/restart-inference`, { method: "POST" });
    void restartRes;

    const ready = await waitForInferenceReady();
    if (!ready) {
      await failJob(
        pool,
        jobId,
        `Se restauraron los archivos de la versión anterior (${meta.previousVersion ?? "estado original"}), pero el servicio de inferencia no volvió a estar disponible`
      );
      return;
    }

    await writeUninstallMeta({ currentVersion: meta.previousVersion, previousVersion: null });
    await clearPreviousBackup();

    await completeJob(pool, jobId, { ok: true, version: meta.previousVersion });
  } catch (err) {
    await failJob(pool, jobId, err instanceof Error ? err.message : String(err));
  }
}

interface UninstallBody {
  modelId?: string;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as UninstallBody;

  if (!body.modelId) {
    const meta = await readUninstallMeta();
    if (meta.currentVersion === null) {
      return NextResponse.json({ error: "No hay ninguna versión instalada para desinstalar" }, { status: 400 });
    }
  }

  const pool = getPool();
  const jobId = await createJob(pool, "model-uninstall", body.modelId ?? "Lumi Preview");
  const origin = new URL(request.url).origin;
  void runModelUninstallJob(pool, jobId, { modelId: body.modelId, origin });

  return NextResponse.json({ jobId }, { status: 202 });
}