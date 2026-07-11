// apps/web/app/api/images/indexed/[indexedImageId]/route.ts
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { getPool } from "../../../../../lib/db";

export async function GET(
  _request: Request,
  { params }: { params: { indexedImageId: string } }
) {
  const pool = getPool();
  const { rows } = await pool.query<{ image_path: string | null }>(
    `SELECT image_path FROM indexed_images WHERE id = $1`,
    [params.indexedImageId]
  );
  if (rows.length === 0 || !rows[0].image_path) {
    return NextResponse.json({ error: "image not found" }, { status: 404 });
  }

  try {
    const bytes = await readFile(rows[0].image_path);
    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return NextResponse.json({ error: "image file missing on disk" }, { status: 404 });
  }
}
