import { NextResponse } from "next/server";
import desreclamos from "../../../releases/desreclamos.json";

/// Sin filtrar, sin parámetros: se sirve el documento firmado completo, igual
/// que /api/versiones — recortarlo aquí rompería la firma, que cubre
/// exactamente lo que se entrega.
export async function GET() {
  return NextResponse.json(desreclamos, {
    headers: {
      "cache-control": "public, max-age=300, s-maxage=300",
      "access-control-allow-origin": "*",
    },
  });
}
