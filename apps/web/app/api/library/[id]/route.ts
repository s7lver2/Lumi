// apps/web/app/api/library/[id]/route.ts
import { NextResponse } from "next/server";
import { getImage, removeImage, replaceImageBytes } from "../../../../lib/image-library";
import { validateImageBytes } from "../../../../lib/image-validation";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const image = getImage(params.id);
  if (!image) {
    return NextResponse.json({ error: "Imagen no encontrada" }, { status: 404 });
  }
  removeImage(params.id);
  return new NextResponse(null, { status: 204 });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const existing = getImage(params.id);
  if (!existing) {
    return NextResponse.json({ error: "Imagen no encontrada" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "La petición debe ser multipart/form-data" }, { status: 400 });
  }

  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Falta el campo image" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const validation = await validateImageBytes(bytes);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  const updated = replaceImageBytes(params.id, bytes, validation.width, validation.height);
  const { bytes: _omit, ...summary } = updated!;
  return NextResponse.json({ image: summary }, { status: 200 });
}