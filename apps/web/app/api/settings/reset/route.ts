// apps/web/app/api/settings/reset/route.ts
import { NextResponse } from "next/server";
import { resolve } from "node:path";
import { getPool } from "../../../../lib/db";
import { getSettingsRepo } from "../../../../lib/settings-repo";
import { backupDatabaseToJson, APPLICATION_TABLES } from "../../../../lib/settings/db-backup";
import { restoreInferenceCode } from "../../../../lib/model-catalog/backup";
import {
  PREVIOUS_CODE_DIR,
  readUninstallMeta,
  writeUninstallMeta,
  clearPreviousBackup,
} from "../../../../lib/model-catalog/uninstall-state";
import { getRepoRoot } from "../../../../lib/repo-root";

// Same INFERENCE_DIR/URL/poll derivation as the feature this replaces
// (apps/web/app/api/model-catalog/uninstall/route.ts). Must be the real
// repo checkout, not process.cwd()'s "../.." — see repo-root.ts.
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

interface ResetBody {
  confirm?: string;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ResetBody;
  if (body.confirm !== "RESET") {
    return NextResponse.json({ error: 'confirm must be exactly "RESET"' }, { status: 400 });
  }

  const pool = getPool();

  try {
    await backupDatabaseToJson(pool);
  } catch (err) {
    return NextResponse.json(
      { error: `No se pudo generar la copia de seguridad: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  const meta = await readUninstallMeta();
  if (meta.currentVersion !== null || meta.previousVersion !== null) {
    try {
      await restoreInferenceCode(INFERENCE_DIR, PREVIOUS_CODE_DIR);

      const origin = new URL(request.url).origin;
      const restartRes = await fetch(`${origin}/api/setup/run/restart-inference`, { method: "POST" });
      void restartRes; // SSE stream — we just wait for real readiness below.
    } catch (err) {
      return NextResponse.json(
        { error: `No se pudieron restaurar los archivos originales: ${err instanceof Error ? err.message : String(err)}` },
        { status: 502 }
      );
    }

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

  await pool.query(`TRUNCATE TABLE ${APPLICATION_TABLES.join(", ")} RESTART IDENTITY CASCADE`);

  // worker_heartbeat's row 1 is seeded once by its migration (db/migrations/
  // 1720700000000_worker_heartbeat.js) and never re-created afterward — the
  // worker only ever UPDATEs it (apps/worker/src/heartbeat.ts), it has no
  // upsert/bootstrap fallback. Truncating it without reseeding leaves
  // /api/health's "SELECT ... WHERE id = 1" permanently empty, reporting the
  // worker as stopped forever even though the (unrestarted) worker process
  // is running fine — confirmed live after a real reset.
  await pool.query(`INSERT INTO worker_heartbeat (id, updated_at) VALUES (1, now())`);

  const repo = getSettingsRepo();
  // The TRUNCATE above bypassed the repo entirely, so its in-memory cache
  // still holds every setting's pre-reset value (including
  // isSetupCompleted() returning true) for up to its TTL — confirmed live:
  // the app kept skipping the /setup redirect right after a real reset.
  repo.clearCache();
  await repo.setSetting("RETRIEVAL_MODEL", "lumi-preview", false);
  await repo.setSetting("VERIFICATION_MODEL", "", false);

  return NextResponse.json({ ok: true });
}