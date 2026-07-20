// apps/web/app/api/jobs/[id]/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../../lib/db";
import { getJob } from "../../../../lib/background-jobs";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const job = await getJob(getPool(), params.id);
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }
  return NextResponse.json(job);
}