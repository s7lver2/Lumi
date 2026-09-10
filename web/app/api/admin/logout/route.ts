import { NextResponse } from "next/server";
import { NOMBRE_COOKIE } from "@/lib/adminAuth";

/// Decisión de diseño (el spec original pide que "Cerrar sesión" borre la
/// cookie client-side, pero la cookie de sesión es `HttpOnly` por diseño —
/// sección 2 del encargo — precisamente para que ningún script en la página
/// pueda leerla ni tocarla; JavaScript no puede borrar una cookie
/// `HttpOnly`. Esta ruta es el único borrado real posible: el botón de
/// `page.tsx` la llama y redirige de vuelta a `/admin` sin sesión.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(NOMBRE_COOKIE);
  return res;
}
