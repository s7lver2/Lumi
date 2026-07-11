// apps/web/app/api/images/query/[searchId]/route.ts
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { getPool } from "../../../../../lib/db";

export async function GET(
  _request: Request,
  { params }: { params: { searchId: string } }
) {
  const pool = getPool();
  const { rows } = await pool.query<{ query_image_path: string | null }>(
    `SELECT query_image_path FROM searches WHERE id = $1`,
    [params.searchId]
  );
  if (rows.length === 0 || !rows[0].query_image_path) {
    return NextResponse.json({ error: "query image not found" }, { status: 404 });
  }

  try {
    const bytes = await readFile(rows[0].query_image_path);
    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return NextResponse.json({ error: "query image file missing on disk" }, { status: 404 });
  }
}
