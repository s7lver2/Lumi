// apps/web/app/api/search/batch/active/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../../../lib/db";

// See apps/web/app/api/health/route.ts's identical comment — this route
// also has no request-derived inputs, so it needs the same explicit opt-out
// of build-time static prerendering.
export const dynamic = "force-dynamic";

export async function GET() {
  const { rows } = await getPool().query(
    `SELECT id, status, total, done, failed, current_phase FROM search_batches
     WHERE status IN ('pending', 'running')
     ORDER BY id DESC LIMIT 1`
  );
  const row = rows[0];
  const batch = row
    ? { id: row.id, status: row.status, total: row.total, done: row.done, failed: row.failed, currentPhase: row.current_phase }
    : null;
  return NextResponse.json({ batch });
}