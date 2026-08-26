import { NextResponse } from "next/server";
import manifiesto from "../../../releases/versiones.json";

/// Sin filtrar, sin parámetros: se sirve el documento firmado completo.
/// En cuanto el servidor recortara la respuesta, la firma dejaría de cubrir
/// exactamente lo que se entrega — ver la spec, sección "La API en Vercel".
export async function GET() {
  return NextResponse.json(manifiesto, {
    headers: {
      "cache-control": "public, max-age=300, s-maxage=300",
      "access-control-allow-origin": "*",
    },
  });
}
