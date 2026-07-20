// apps/web/app/api/model-catalog/uninstall/route.ts
import { NextResponse } from "next/server";
import { readUninstallMeta } from "../../../../lib/model-catalog/uninstall-state";
import { getClassificationModelHistory } from "../../../../lib/model-catalog/classification-models";
import { getPool } from "../../../../lib/db";
import { createJob } from "../../../../lib/background-jobs";
import { runModelUninstallJob } from "./run-job";

export async function GET(request: Request) {
  const modelId = new URL(request.url).searchParams.get("modelId");
  if (modelId) {
    const history = await getClassificationModelHistory(getPool(), modelId);
    return NextResponse.json(history);
  }

  const meta = await readUninstallMeta();
  return NextResponse.json({ available: meta.previousVersion !== null || meta.currentVersion !== null, previousVersion: meta.previousVersion });
}

interface UninstallBody {
  modelId?: string;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as UninstallBody;

  const meta = await readUninstallMeta();
  if (!body.modelId && meta.currentVersion === null) {
    return NextResponse.json({ error: "No hay ninguna versión instalada para desinstalar" }, { status: 400 });
  }

  const pool = getPool();
  const jobId = await createJob(pool, "model-uninstall", body.modelId ?? "Model Snapshot/Classifier Rollback");
  const origin = new URL(request.url).origin;
  void runModelUninstallJob(pool, jobId, { modelId: body.modelId, meta, origin });

  return NextResponse.json({ jobId }, { status: 202 });
}
