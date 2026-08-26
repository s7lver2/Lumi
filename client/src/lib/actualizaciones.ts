import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export type EstadoActualizacion =
  | { tipo: "disponible"; version: string; notas: string; url: string }
  | { tipo: "retirada" };

/** `null` = no hay nada nuevo. Lanza si no se pudo comprobar (sin red,
 *  manifiesto sin firmar o con firma inválida) — quien llama decide qué
 *  hacer con eso; ver `App.tsx` (silencioso) y `ProfileView.tsx` (visible,
 *  porque ahí sí lo pediste tú). */
export function comprobarActualizacion(): Promise<EstadoActualizacion | null> {
  return invoke<EstadoActualizacion | null>("comprobar_actualizacion");
}

export function abrirDescarga(url: string): Promise<void> {
  return openUrl(url);
}
