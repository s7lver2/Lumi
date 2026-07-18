// apps/web/app/api/library/from-url/route.ts
import { NextResponse } from "next/server";
import { addImage } from "../../../../lib/image-library";
import { validateImageBytes } from "../../../../lib/image-validation";
import { fetchImageUrl } from "../../../../lib/fetch-image-url";

export async function POST(request: Request) {
  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON no válido" }, { status: 400 });
  }

  if (typeof body.url !== "string" || body.url.length === 0) {
    return NextResponse.json({ error: "Falta el campo url" }, { status: 400 });
  }

  const downloaded = await fetchImageUrl(body.url);
  if (!downloaded.ok) {
    return NextResponse.json({ error: downloaded.reason }, { status: 400 });
  }

  const validation = await validateImageBytes(downloaded.bytes);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  const filename = body.url.split("/").pop()?.split("?")[0] || `imagen.${validation.format === "jpeg" ? "jpg" : validation.format}`;

  const image = addImage({
    bytes: downloaded.bytes,
    filename,
    mimeType: `image/${validation.format}`,
    width: validation.width,
    height: validation.height,
    sourceKind: "url",
  });

  const { bytes: _omit, ...summary } = image;
  return NextResponse.json({ image: summary }, { status: 201 });
}