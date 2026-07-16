// apps/web/app/api/models/route.ts
import { NextResponse } from "next/server";
import { RETRIEVAL_MODELS } from "@netryx/shared-types";

export async function GET() {
  return NextResponse.json({
    models: RETRIEVAL_MODELS.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      status: m.status,
      version: m.version,
      endpoints: {
        estimate: {
          method: "POST",
          path: `/api/models/${m.id}/estimate`,
          description:
            'Sube una imagen (multipart/form-data, campo "image"); devuelve regiones candidatas con su score.',
        },
        refine: {
          method: "POST",
          path: `/api/models/${m.id}/refine`,
          description:
            "Envía un searchId + regionId de una estimación previa; devuelve los candidatos de esa región re-puntuados por verificación geométrica (streaming SSE).",
        },
      },
    })),
  });
}
