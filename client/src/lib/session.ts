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

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function updateSession(patch: Partial<Session>) {
  const cur = loadSession() ?? { addr: "", fingerprint: "" };
  saveSession({ ...cur, ...patch });
}

export function clearSession() {
  localStorage.removeItem(KEY);
}

export function loadServers(): Server[] {
  try {
    return JSON.parse(localStorage.getItem(SERVERS) ?? "[]") as Server[];
  } catch {
    return [];
  }
}

export function addServer(s: Server) {
  // Se indexa por dirección: volver a añadir el mismo servidor actualiza su
  // huella (rotación de certificado) en vez de duplicar la entrada.
  const rest = loadServers().filter((x) => x.addr !== s.addr);
  localStorage.setItem(SERVERS, JSON.stringify([s, ...rest]));
}

export function forgetServer(addr: string) {
  localStorage.setItem(SERVERS, JSON.stringify(loadServers().filter((s) => s.addr !== addr)));
}

/** Identidad del equipo. Registro PASIVO: audita y permite revocar, no
 *  autentica. Copiar este valor copia la identidad, y es a propósito. */
export function deviceId(): string {
  let id = localStorage.getItem(DEVICE);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE, id);
  }
  return id;
}

export function deviceName(): string {
  return navigator.platform || "equipo";
}
