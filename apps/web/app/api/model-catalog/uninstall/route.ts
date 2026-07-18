// apps/web/app/api/model-catalog/uninstall/route.ts
import { NextResponse } from "next/server";
import { resolve } from "node:path";
import { restoreInferenceCode } from "../../../../lib/model-catalog/backup";
import { PREVIOUS_CODE_DIR, readUninstallMeta, writeUninstallMeta, clearPreviousBackup } from "../../../../lib/model-catalog/uninstall-state";

// Same INFERENCE_DIR derivation as install/route.ts.
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

export async function GET() {
  const meta = await readUninstallMeta();
  return NextResponse.json({ available: meta.previousVersion !== null || meta.currentVersion !== null, previousVersion: meta.previousVersion });
}

export async function POST(request: Request) {
  const meta = await readUninstallMeta();
  if (meta.currentVersion === null) {
    return NextResponse.json({ error: "No hay ninguna versión instalada para desinstalar" }, { status: 400 });
  }

  await restoreInferenceCode(INFERENCE_DIR, PREVIOUS_CODE_DIR);

  const origin = new URL(request.url).origin;
  const restartRes = await fetch(`${origin}/api/setup/run/restart-inference`, { method: "POST" });
  void restartRes; // SSE stream — we just wait for real readiness below.

  const ready = await waitForInferenceReady();
  if (!ready) {
    return NextResponse.json(
      { error: `Se restauraron los archivos de la versión anterior (${meta.previousVersion ?? "estado original"}), pero el servicio de inferencia no volvió a estar disponible` },
      { status: 502 }
    );
  }

  // Single level of undo — matches the one persistent snapshot we keep.
  await writeUninstallMeta({ currentVersion: meta.previousVersion, previousVersion: null });
  await clearPreviousBackup();

  return NextResponse.json({ ok: true, version: meta.previousVersion });
}
