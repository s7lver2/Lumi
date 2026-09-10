import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { estaPendiente, leerCola } from "@/lib/liberaciones";

/// Lista para el panel `/admin`: solo lo que todavía espera una decisión.
/// Usa `GITHUB_LIBERACIONES_TOKEN` para leer (aunque el repo sea público,
/// leer sin testigo comparte el límite de tasa anónimo de GitHub entre
/// cualquiera que visite la web — con testigo, el panel tiene su propio
/// cupo). Protegida por `requireAdmin`: sin sesión de admin válida, 401.
export async function GET(req: NextRequest) {
  const login = requireAdmin(req);
  if (!login) {
    return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  }

  try {
    const { lista } = await leerCola(process.env.GITHUB_LIBERACIONES_TOKEN);
    return NextResponse.json({ pendientes: lista.filter(estaPendiente) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
