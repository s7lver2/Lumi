// apps/web/app/api/model-catalog/reset/route.ts
import { NextResponse } from "next/server";
import { resolve } from "node:path";
import { getPool } from "../../../../lib/db";
import { getSettingsRepo } from "../../../../lib/settings-repo";
import { deleteAllClassificationModels } from "../../../../lib/model-catalog/classification-models";
import { restoreInferenceCode } from "../../../../lib/model-catalog/backup";
import { PREVIOUS_CODE_DIR, readUninstallMeta, writeUninstallMeta, clearPreviousBackup } from "../../../../lib/model-catalog/uninstall-state";

// Same INFERENCE_DIR/URL/poll derivation as uninstall/route.ts.
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

interface ResetBody {
  confirm?: string;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ResetBody;
  if (body.confirm !== "RESET") {
    return NextResponse.json({ error: 'confirm must be exactly "RESET"' }, { status: 400 });
  }

  const pool = getPool();
  await deleteAllClassificationModels(pool);

  const meta = await readUninstallMeta();
  if (meta.currentVersion !== null || meta.previousVersion !== null) {
    await restoreInferenceCode(INFERENCE_DIR, PREVIOUS_CODE_DIR);

    const origin = new URL(request.url).origin;
    const restartRes = await fetch(`${origin}/api/setup/run/restart-inference`, { method: "POST" });
    void restartRes; // SSE stream — we just wait for real readiness below.

    const ready = await waitForInferenceReady();
    if (!ready) {
      return NextResponse.json(
        { error: "Se restauraron los archivos originales, pero el servicio de inferencia no volvió a estar disponible" },
        { status: 502 }
      );
    }

    await writeUninstallMeta({ currentVersion: null, previousVersion: null });
    await clearPreviousBackup();
  }

  const repo = getSettingsRepo();
  await repo.setSetting("RETRIEVAL_MODEL", "lumi-preview", false);
  await repo.setSetting("VERIFICATION_MODEL", "", false);

  return NextResponse.json({ ok: true });
}
