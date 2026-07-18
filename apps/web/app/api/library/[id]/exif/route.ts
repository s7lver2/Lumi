// apps/web/app/api/library/[id]/exif/route.ts
import { NextResponse } from "next/server";
import { getImage } from "../../../../../lib/image-library";
import { readExifSummary } from "../../../../../lib/exif-read";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const image = getImage(params.id);
  if (!image) {
    return NextResponse.json({ error: "Imagen no encontrada" }, { status: 404 });
  }
  const exif = await readExifSummary(image.bytes);
  return NextResponse.json({ exif });
}