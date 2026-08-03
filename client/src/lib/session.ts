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
const ENV = "lumi.env";

// Namespacing de entornos para el orbe de debug (solo dev, ver
// client/src/dev/DebugOrb.tsx). El entorno "1" usa las claves de siempre sin
// sufijo, para no invalidar sesiones que ya existieran de antes de esto.
//
// El PUNTERO de qué entorno está activo va en sessionStorage, no en
// localStorage: localStorage se comparte entre todas las ventanas del mismo
// origen, así que cambiar de entorno en una ventana movía también el
// puntero de las demás (solo se notaba al recargarlas). sessionStorage es
// por ventana — cada una puede tener su propio entorno activo a la vez.
// Los DATOS de cada entorno sí siguen en localStorage: eso es lo que
// permite verlos desde el panel de admin sin importar qué ventana los creó.
function currentEnv(): string {
  return sessionStorage.getItem(ENV) ?? "1";
}
function nsKey(base: string): string {
  const env = currentEnv();
  return env === "1" ? base : `${base}::${env}`;
}
export function getEnv(): string {
  return currentEnv();
}
export function setEnv(env: string) {
  sessionStorage.setItem(ENV, env);
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
