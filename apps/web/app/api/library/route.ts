import { NextResponse } from "next/server";
import { addImage, listImages, type LibraryImage } from "../../../lib/image-library";
import { validateImageBytes } from "../../../lib/image-validation";

function toSummary(image: LibraryImage) {
  const { bytes, ...summary } = image;
  return summary;
}

export async function GET() {
  return NextResponse.json({ images: listImages().map(toSummary) });
}

export async function POST(request: Request) {
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

  try {
    const image = addImage({
      bytes,
      filename: file.name,
      mimeType: `image/${validation.format}`,
      width: validation.width,
      height: validation.height,
      sourceKind: "upload",
    });
    return NextResponse.json({ image: toSummary(image) }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "No se pudo añadir la imagen" },
      { status: 400 }
    );
  }
}
