// apps/web/app/api/library/[id]/bytes/route.ts
import { getImage } from "../../../../../lib/image-library";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const image = getImage(params.id);
  if (!image) {
    return new Response(JSON.stringify({ error: "Imagen no encontrada" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(image.bytes as unknown as BodyInit, {
    status: 200,
    headers: { "content-type": image.mimeType },
  });
}