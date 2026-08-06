import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Image } from "./api";

/** Windows y Android sirven los esquemas propios como `http://<esquema>.localhost`;
 *  el resto, como `<esquema>://localhost`. No se usa `convertFileSrc` porque
 *  codifica las barras de la ruta y aquí la ruta es una ruta de verdad. */
const LUMI_BASE = navigator.userAgent.includes("Windows")
  ? "http://lumi.localhost"
  : "lumi://localhost";

/** URL que el webview puede cargar directamente: sale por el cliente TLS
 *  anclado sin que el webview vea el certificado autofirmado. */
export const lumiUrl = (path: string) => `${LUMI_BASE}${path}`;

/** El esquema `lumi://` necesita el token para autenticarse, y el token no
 *  puede ir en la URL. Se llama en cada cambio de sesión. */
export const setAuth = (token: string | null) => invoke("set_auth", { token });

/** Arranca la telemetría y el SSE de la cola. Antes solo se llamaba al
 *  RETOMAR una sesión guardada (reabrir la app); entrar por primera vez
 *  —login normal, o tras un cambio de contraseña forzado— dejaba al usuario
 *  sin resultados de sus análisis hasta la próxima vez que cerrara y
 *  reabriera la app, porque ese es el único otro camino que lo llama. Un solo
 *  sitio para los dos arranques, llamado desde todo camino que abre sesión. */
export async function announcePresence(token: string): Promise<void> {
  await invoke("start_telemetry", { token });
  // Abrir este flujo es también anunciarse como presente: mientras esté
  // abierto, el trabajo pendiente de esta persona cuenta como el de alguien
  // que está mirando.
  await invoke("start_queue_events", { token });
}

export async function uploadPaths(caseId: number, paths: string[]): Promise<Image[]> {
  if (paths.length === 0) return [];
  const raw = await invoke<string>("upload_images", { caseId, paths });
  return JSON.parse(raw) as Image[];
}

/** Selector de archivos del sistema. Devuelve rutas, nunca bytes, y no sube
 *  nada: quien llama decide qué hacer con ellas. Antes esto subía por su
 *  cuenta, y por eso no había hueco donde enseñar lo elegido ni elegir modelo
 *  antes de lanzar. */
export async function pickPaths(): Promise<string[]> {
  const sel = await open({
    multiple: true,
    filters: [{ name: "Imágenes", extensions: ["jpg", "jpeg", "png", "webp"] }],
  });
  if (!sel) return [];
  return Array.isArray(sel) ? sel : [sel];
}
