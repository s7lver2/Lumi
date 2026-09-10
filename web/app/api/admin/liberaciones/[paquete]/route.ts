import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { estaPendiente, escribirCola, leerCola } from "@/lib/liberaciones";

interface DecisionBody {
  decision?: "aprobada" | "rechazada";
}

/// Decide una solicitud concreta. Protegida por `requireAdmin`. Escribe
/// siempre con `GITHUB_LIBERACIONES_TOKEN` — el testigo de GitHub del admin
/// que pasó por `/api/admin/callback` no interviene aquí en absoluto, solo
/// sirvió para identificarlo al iniciar sesión.
export async function POST(req: NextRequest, { params }: { params: Promise<{ paquete: string }> }) {
  const login = requireAdmin(req);
  if (!login) {
    return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  }

  const { paquete } = await params;

  let body: DecisionBody;
  try {
    body = (await req.json()) as DecisionBody;
  } catch {
    return NextResponse.json({ error: "cuerpo inválido" }, { status: 400 });
  }
  if (body.decision !== "aprobada" && body.decision !== "rechazada") {
    return NextResponse.json({ error: "decision debe ser 'aprobada' o 'rechazada'" }, { status: 400 });
  }

  const pat = process.env.GITHUB_LIBERACIONES_TOKEN;
  if (!pat) {
    return NextResponse.json(
      { error: "el servidor no tiene configurado GITHUB_LIBERACIONES_TOKEN" },
      { status: 500 },
    );
  }

  try {
    const { lista, sha } = await leerCola(pat);
    const entrada = lista.find((e) => e.paquete === paquete);
    if (!entrada || !estaPendiente(entrada)) {
      return NextResponse.json({ error: "esa solicitud no existe o ya no está pendiente" }, { status: 404 });
    }

    entrada.estado = body.decision;
    await escribirCola(pat, lista, sha, `${body.decision} por ${login}: ${paquete}`);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
