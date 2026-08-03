/** Persistencia de sesión entre reinicios de la app.
 *
 * Sin esto, cerrar la app durante el aprovisionamiento te devolvía al
 * principio: la clave de vinculación es de un solo uso, así que ni
 * siquiera podías volver a pegarla. Se persiste lo mínimo necesario para
 * retomar donde estabas usando la verdad del servidor (`hello.state`), no
 * un número de paso guardado a ciegas. */

export interface Session {
  addr: string;
  fingerprint: string;
  bootstrapToken?: string;
  token?: string;
  taskId?: string;
  /** Credencial de la solicitud de acceso. Vive aquí sin cifrar, igual que el
   *  token: quien tenga el equipo durante las 48 h puede crear la cuenta en
   *  lugar del usuario. Aceptable para esa ventana, no para una más larga. */
  ticket?: string;
  username?: string;
}

/** Servidor recordado. Solo datos públicos: dirección y huella. */
export interface Server {
  addr: string;
  fingerprint: string;
  label: string;
}

const KEY = "lumi.session";
const SERVERS = "lumi.servers";
const DEVICE = "lumi.device";
const ENV_PARAM = "env";

// Namespacing de entornos para el orbe de debug (solo dev, ver
// client/src/dev/DebugOrb.tsx). El entorno "1" usa las claves de siempre sin
// sufijo, para no invalidar sesiones que ya existieran de antes de esto.
//
// El PUNTERO de qué entorno está activo va en la URL de la ventana (?env=N),
// no en almacenamiento. Se probó primero con localStorage (compartido entre
// TODAS las ventanas del origen: cambiar en una movía a las demás) y luego
// con sessionStorage (WebView2, el motor de Tauri en Windows, lo compartió
// igual entre ventanas — no se puede confiar en que aísle por ventana ahí).
// La URL sí es inherentemente por ventana: no hay ninguna forma de que dos
// ventanas compartan la suya. Los DATOS de cada entorno sí siguen en
// localStorage: eso es lo que permite verlos desde el panel de admin sin
// importar qué ventana los creó.
function currentEnv(): string {
  return new URLSearchParams(location.search).get(ENV_PARAM) ?? "1";
}
function nsKey(base: string): string {
  const env = currentEnv();
  return env === "1" ? base : `${base}::${env}`;
}
export function getEnv(): string {
  return currentEnv();
}
/** No cambia nada por sí sola: hace falta recargar para que las funciones de
 *  este módulo (que leen `location.search` en el momento) empiecen a usar
 *  el namespace nuevo. El orbe llama a `location.reload()` justo después. */
export function setEnv(env: string) {
  const url = new URL(location.href);
  url.searchParams.set(ENV_PARAM, env);
  history.replaceState(null, "", url);
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(nsKey(KEY));
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session) {
  localStorage.setItem(nsKey(KEY), JSON.stringify(s));
}

export function updateSession(patch: Partial<Session>) {
  const cur = loadSession() ?? { addr: "", fingerprint: "" };
  saveSession({ ...cur, ...patch });
}

export function clearSession() {
  localStorage.removeItem(nsKey(KEY));
}

export function loadServers(): Server[] {
  try {
    return JSON.parse(localStorage.getItem(nsKey(SERVERS)) ?? "[]") as Server[];
  } catch {
    return [];
  }
}

export function addServer(s: Server) {
  // Se indexa por dirección: volver a añadir el mismo servidor actualiza su
  // huella (rotación de certificado) en vez de duplicar la entrada.
  const rest = loadServers().filter((x) => x.addr !== s.addr);
  localStorage.setItem(nsKey(SERVERS), JSON.stringify([s, ...rest]));
}

export function forgetServer(addr: string) {
  localStorage.setItem(nsKey(SERVERS), JSON.stringify(loadServers().filter((s) => s.addr !== addr)));
}

/** Identidad del equipo. Registro PASIVO: audita y permite revocar, no
 *  autentica. Copiar este valor copia la identidad, y es a propósito. */
export function deviceId(): string {
  let id = localStorage.getItem(nsKey(DEVICE));
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(nsKey(DEVICE), id);
  }
  return id;
}

/** Borra todas las claves del entorno activo. Usado por "reset" del orbe de
 *  debug: repetir una prueba desde cero sin cambiar de entorno. */
export function resetEnv() {
  localStorage.removeItem(nsKey(KEY));
  localStorage.removeItem(nsKey(SERVERS));
  localStorage.removeItem(nsKey(DEVICE));
}

export function deviceName(): string {
  return navigator.platform || "equipo";
}
