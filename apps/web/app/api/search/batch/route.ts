// apps/web/app/api/search/batch/route.ts
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getPool } from "../../../../lib/db";
import { enqueueAnalyzeImageBatchJob } from "../../../../lib/queue";

export async function POST(request: Request) {
  let body: { imageIds?: unknown; modelId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON no válido" }, { status: 400 });
  }

  if (!Array.isArray(body.imageIds) || body.imageIds.length === 0 || typeof body.modelId !== "string") {
    return NextResponse.json({ error: "imageIds y modelId son obligatorios" }, { status: 400 });
  }

  const imageIds = body.imageIds as string[];
  const modelId = body.modelId;
  const batchId = randomUUID();

  const pool = getPool();
  await pool.query("INSERT INTO search_batches (id, total) VALUES ($1, $2)", [batchId, imageIds.length]);

  await enqueueAnalyzeImageBatchJob({ batchId, imageIds, modelId });

  return NextResponse.json({ batchId }, { status: 201 });
}