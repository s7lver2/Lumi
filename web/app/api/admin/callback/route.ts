import { NextRequest, NextResponse } from "next/server";
import { NOMBRE_COOKIE, NOMBRE_COOKIE_ESTADO, firmarSesion } from "@/lib/adminAuth";

/// Vuelta del flujo de Authorization Code de la App OAuth del panel (ver
/// `login/route.ts`). El testigo que se obtiene aquí NUNCA se guarda ni se
/// usa para escribir en el repo — solo sirve para preguntarle a GitHub
/// "¿quién eres?" una vez, y se descarta. Quien escribe
/// `liberaciones-pendientes.json` sigue siendo, en todas las rutas,
/// `GITHUB_LIBERACIONES_TOKEN` (un PAT del proyecto, no de ninguna
/// persona).
function paginaError(mensaje: string): NextResponse {
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Acceso denegado — Lumi admin</title>
<style>
  body { background:#0e0f11; color:#e8e8e6; font-family:Inter,system-ui,sans-serif;
         display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; }
  main { max-width:420px; padding:0 24px; text-align:center; }
  h1 { font-size:20px; margin-bottom:12px; }
  p { color:#9a9a95; line-height:1.5; }
  a { color:#e8e8e6; }
</style></head>
<body><main>
  <h1>Acceso denegado</h1>
  <p>${mensaje}</p>
  <p><a href="/admin">Volver</a></p>
</main></body></html>`;
  return new NextResponse(html, { status: 403, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const estadoEsperado = req.cookies.get(NOMBRE_COOKIE_ESTADO)?.value;

  if (!code || !state || !estadoEsperado || state !== estadoEsperado) {
    return paginaError("La respuesta de GitHub no trae un estado válido. Vuelve a intentarlo desde el botón de acceso.");
  }

  const clientId = process.env.ADMIN_GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.ADMIN_GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "el servidor no tiene configurado ADMIN_GITHUB_OAUTH_CLIENT_ID/SECRET" },
      { status: 500 },
    );
  }

  const redirectUri = `${req.nextUrl.origin}/api/admin/callback`;
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });
  if (!tokenRes.ok) {
    return paginaError("GitHub no aceptó el intercambio del código de autorización.");
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenJson.access_token) {
    return paginaError(`GitHub devolvió un error al canjear el código: ${tokenJson.error ?? "desconocido"}.`);
  }

  const userRes = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${tokenJson.access_token}`, "user-agent": "lumi-web-admin" },
  });
  if (!userRes.ok) {
    return paginaError("No se pudo leer la identidad de GitHub con el testigo recibido.");
  }
  const user = (await userRes.json()) as { login?: string };
  const login = user.login;
  if (!login) {
    return paginaError("La respuesta de GitHub no trae un usuario reconocible.");
  }

  const permitidos = (process.env.ADMIN_GITHUB_LOGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!permitidos.includes(login)) {
    // Sin cookie de sesión: esta cuenta se autenticó de verdad contra
    // GitHub, pero no está en la lista blanca de administradores.
    return paginaError(`La cuenta de GitHub «${login}» no está autorizada para este panel.`);
  }

  const res = NextResponse.redirect(new URL("/admin", req.nextUrl.origin));
  res.cookies.set(NOMBRE_COOKIE, firmarSesion(login), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 12 * 60 * 60,
    path: "/",
  });
  res.cookies.delete(NOMBRE_COOKIE_ESTADO);
  return res;
}
