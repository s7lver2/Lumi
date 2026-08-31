import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export type EstadoActualizacion =
  | { tipo: "disponible"; version: string; notas: string; url: string }
  | { tipo: "retirada" }
  | { tipo: "error"; motivo: string };

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

/** Se llama una vez al arrancar (App.tsx) — si la última actualización
 *  silenciosa falló, esto trae el motivo y lo borra (se muestra una sola
 *  vez). `null` = no hay nada pendiente. */
export function errorActualizacionPendiente(): Promise<string | null> {
  return invoke<string | null>("error_actualizacion_pendiente");
}

/** Cierra esta app y aplica la actualización en segundo plano. No vuelve —
 *  la ventana se cierra dentro del comando de Rust. */
export function dispararActualizacionSilenciosa(versionNueva: string): Promise<void> {
  return invoke("disparar_actualizacion_silenciosa", { versionNueva });
}

/** Mismo camino que `dispararActualizacionSilenciosa`, pero para igualar
 *  una versión exacta (downgrade, o la versión de un servidor que no es la
 *  última publicada) en vez de "la más nueva". No vuelve — la ventana se
 *  cierra dentro del comando de Rust. */
export function dispararActualizacionAVersion(versionObjetivo: string): Promise<void> {
  return invoke("disparar_actualizacion_a_version", { versionObjetivo });
}

/** La misma versión que `connect()` ya compara contra `hello.version` —
 *  para pintarla junto a la marca en la barra de título. */
export function versionCliente(): Promise<string> {
  return invoke<string>("version_cliente");
}
