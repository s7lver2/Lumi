import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";

/// Sesión del panel de administración (`/admin`): una cookie firmada con
/// HMAC-SHA256 sobre `ADMIN_SESSION_SECRET`, sin ninguna librería de auth
/// (NextAuth incluida) — así lo pide el spec, el proyecto no tiene ninguna
/// dependencia de sesiones instalada y esto no la necesita. El testigo de
/// GitHub del admin (`ADMIN_GITHUB_OAUTH_CLIENT_SECRET`) solo sirve para
/// verificar SU identidad en `/api/admin/callback`; nunca se guarda en la
/// cookie ni se usa para escribir en el repo — eso sigue siendo
/// `GITHUB_LIBERACIONES_TOKEN`, un PAT totalmente distinto.

const NOMBRE_COOKIE = "lumi_admin_session";
/// Cookie efímera de un solo uso para el `state` anti-CSRF del login — vive
/// aquí (no en `route.ts`) porque un fichero de ruta de Next solo puede
/// exportar handlers HTTP y unas pocas constantes de configuración; un
/// export cualquiera como este rompe la comprobación de tipos de rutas.
const NOMBRE_COOKIE_ESTADO = "lumi_admin_oauth_state";
const DURACION_SESION_MS = 12 * 60 * 60 * 1000; // 12 horas, tal como pide el spec.

interface PayloadSesion {
  login: string;
  exp: number;
}

function secreto(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s) throw new Error("falta ADMIN_SESSION_SECRET en el entorno");
  return s;
}

function firmar(base64Payload: string): string {
  return createHmac("sha256", secreto()).update(base64Payload).digest("base64url");
}

/// Construye el valor de cookie `<payload>.<firma>`, ambos en base64url para
/// que quepan en un valor de cookie sin escapar.
export function firmarSesion(login: string): string {
  const payload: PayloadSesion = { login, exp: Date.now() + DURACION_SESION_MS };
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${base64Payload}.${firmar(base64Payload)}`;
}

/// Lista de cuentas admitidas, leída en cada verificación (no en el momento
/// de firmar) — así revocar a alguien de `ADMIN_GITHUB_LOGINS` en Vercel
/// cierra sus sesiones ya emitidas sin esperar a que expiren solas.
function loginsPermitidos(): string[] {
  return (process.env.ADMIN_GITHUB_LOGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/// Verifica firma (comparación en tiempo constante), expiración y que el
/// login siga en la lista permitida. Devuelve el login si todo pasa, o
/// `null` si cualquier comprobación falla — nunca lanza, para que las rutas
/// puedan tratarlo como "no autenticado" sin try/catch propio.
export function verificarSesion(valor: string | undefined): string | null {
  if (!valor) return null;
  const punto = valor.indexOf(".");
  if (punto < 0) return null;
  const base64Payload = valor.slice(0, punto);
  const firmaRecibida = valor.slice(punto + 1);

  const firmaEsperada = firmar(base64Payload);
  const a = Buffer.from(firmaRecibida);
  const b = Buffer.from(firmaEsperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: PayloadSesion;
  try {
    payload = JSON.parse(Buffer.from(base64Payload, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
  if (typeof payload.login !== "string" || typeof payload.exp !== "number") return null;
  if (Date.now() > payload.exp) return null;
  if (!loginsPermitidos().includes(payload.login)) return null;

  return payload.login;
}

/// Punto único que usan las rutas protegidas: lee la cookie de la request y
/// devuelve el login o `null`. Nunca lee el body ni ningún otro header —
/// así una ruta protegida no puede confundir un testigo de GitHub del
/// cliente con una sesión de admin.
export function requireAdmin(req: NextRequest): string | null {
  return verificarSesion(req.cookies.get(NOMBRE_COOKIE)?.value);
}

export { NOMBRE_COOKIE, NOMBRE_COOKIE_ESTADO };
