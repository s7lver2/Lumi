import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { NOMBRE_COOKIE_ESTADO } from "@/lib/adminAuth";

/// Arranca el login del panel `/admin`. App OAuth de GitHub DISTINTA de la
/// que ya usa el Indexer (`indexer/src-tauri/src/identidad.rs`, flujo de
/// dispositivo, sin callback): esta necesita el flujo estándar de
/// Authorization Code porque corre en un navegador con una URL de vuelta,
/// no en una app de escritorio pidiendo un código de 8 letras. Scope
/// mínimo: `read:user`, lo justo para leer el `login` en el callback.

export async function GET(req: NextRequest) {
  const clientId = process.env.ADMIN_GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "el servidor no tiene configurado ADMIN_GITHUB_OAUTH_CLIENT_ID" },
      { status: 500 },
    );
  }

  // `state` de un solo uso contra CSRF de login: sin esto, alguien podría
  // arrastrar a un admin a completar el intercambio con el `code` de OTRA
  // cuenta de GitHub y dejarlo con una sesión que no es la suya. Se guarda
  // en una cookie efímera propia, no en la de sesión.
  const state = randomBytes(16).toString("hex");
  const redirectUri = `${req.nextUrl.origin}/api/admin/callback`;

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url.toString());
  res.cookies.set(NOMBRE_COOKIE_ESTADO, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
