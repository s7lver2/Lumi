// apps/web/app/api/areas/export/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../../lib/db";
import { buildAreasZip } from "../../../../lib/datasets/export-bundle";
import { getActiveModelTag } from "../../../../lib/datasets/active-model";

interface ExportBody {
  areaIds?: string[];
}

export async function POST(request: Request) {
  const body = (await request.json()) as ExportBody;
  if (!body.areaIds || !Array.isArray(body.areaIds) || body.areaIds.length === 0) {
    return NextResponse.json({ error: "areaIds is required" }, { status: 400 });
  }

  const model = await getActiveModelTag();
  let buffer: Uint8Array;
  try {
    buffer = await buildAreasZip(getPool(), body.areaIds, model);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 });
  }

  const filename = `lumi-areas-${new Date().toISOString().slice(0, 10)}.zip`;
  return new NextResponse(buffer as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
