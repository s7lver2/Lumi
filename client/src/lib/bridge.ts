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

/** El SSE de una instalación de índice en curso, reemitido como evento
 *  `indices-progress`. `IndexToast` la llama al montar el panel (para
 *  descubrir una instalación ya en marcha) e `InstallFlow` al confirmar una
 *  nueva — dos llamadas concurrentes no son un problema, cada una abre su
 *  propia conexión SSE y ambas reciben la misma fotografía del servidor. */
export const startIndicesEvents = (token: string) => invoke("start_indices_events", { token });
export const startAdminEvents = (token: string) => invoke("start_admin_events", { token });
export const startLogsStream = (token: string) => invoke("start_logs_stream", { token });

export async function uploadPaths(caseId: number, paths: string[]): Promise<Image[]> {
  if (paths.length === 0) return [];
  const raw = await invoke<string>("upload_images", { caseId, paths });
  return JSON.parse(raw) as Image[];
}

/** Lee un archivo local como `data:` URL, para poder mostrarlo dentro del
 *  editor de recorte (`ImageCropModal`) antes de subir nada. */
export function readImageAsDataUrl(path: string): Promise<string> {
  return invoke("read_image_as_data_url", { path });
}

/** El recorte ya viene hecho (un `<canvas>` exportado a JPEG en base64,
 *  ver `ImageCropModal`) — estos tres solo mandan el resultado. */
export function uploadAvatarBytes(dataBase64: string): Promise<void> {
  return invoke("upload_avatar_bytes", { dataBase64 });
}
export function uploadServerAvatarBytes(dataBase64: string): Promise<void> {
  return invoke("upload_server_avatar_bytes", { dataBase64 });
}
export function uploadServerBannerBytes(dataBase64: string): Promise<void> {
  return invoke("upload_server_banner_bytes", { dataBase64 });
}

/** El `Blob` que produce el `<canvas>` del editor de recorte, como base64
 *  puro (sin el prefijo `data:...;base64,`) — es lo que esperan los
 *  comandos de subida de arriba. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
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

/** Como `pickPaths`, pero para un único archivo — foto de perfil, avatar o
 *  banner de servidor: aquí no tiene sentido elegir varios. */
export async function pickImagePath(): Promise<string | null> {
  const sel = await open({
    multiple: false,
    filters: [{ name: "Imágenes", extensions: ["jpg", "jpeg", "png", "webp"] }],
  });
  return typeof sel === "string" ? sel : null;
}
