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

export async function uploadPaths(caseId: number, paths: string[]): Promise<Image[]> {
  if (paths.length === 0) return [];
  const raw = await invoke<string>("upload_images", { caseId, paths });
  return JSON.parse(raw) as Image[];
}

/** Selector de archivos del sistema. Devuelve rutas, nunca bytes. */
export async function pickAndUpload(caseId: number): Promise<Image[]> {
  const sel = await open({
    multiple: true,
    filters: [{ name: "Imágenes", extensions: ["jpg", "jpeg", "png", "webp"] }],
  });
  if (!sel) return [];
  return uploadPaths(caseId, Array.isArray(sel) ? sel : [sel]);
}
