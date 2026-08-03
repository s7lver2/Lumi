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
}

const KEY = "lumi.session";

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
