// apps/web/app/api/areas/[id]/cancel/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../../../lib/db";

// Cancellation is cooperative: this only flips the DB flag. The worker
// (apps/worker/src/jobs/index-area.ts) checks `isCancelled` before it starts
// and once per sampled point during download, so an in-flight job stops
// within roughly one point's worth of latency instead of running to
// completion. See street-view.ts's `shouldCancel` option.
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const pool = getPool();

  const existing = await pool.query<{ status: string }>(
    `SELECT status FROM areas WHERE id = $1`,
    [params.id]
  );
  if (existing.rows.length === 0) {
    return NextResponse.json({ error: "area not found" }, { status: 404 });
  }
  if (!["pending", "indexing"].includes(existing.rows[0].status)) {
    return NextResponse.json(
      { error: `cannot cancel an area in status "${existing.rows[0].status}"` },
      { status: 409 }
    );
  }

  await pool.query(
    `UPDATE areas SET status = 'cancelled', updated_at = now() WHERE id = $1`,
    [params.id]
  );
  return NextResponse.json({ areaId: params.id, status: "cancelled" });
}
