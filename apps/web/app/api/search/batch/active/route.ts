// apps/web/app/api/search/batch/active/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../../../lib/db";

// See apps/web/app/api/health/route.ts's identical comment — this route
// also has no request-derived inputs, so it needs the same explicit opt-out
// of build-time static prerendering.
export const dynamic = "force-dynamic";

export async function GET() {
  const { rows } = await getPool().query(
    `SELECT id, status, total, done, failed FROM search_batches
     WHERE status IN ('pending', 'running')
     ORDER BY id DESC LIMIT 1`
  );
  return NextResponse.json({ batch: rows[0] ?? null });
}