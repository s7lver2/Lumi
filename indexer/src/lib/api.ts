import { invoke } from "@tauri-apps/api/core";

export interface Saludo { version: string; so: string; dir: string }
export interface EstadoServicio { nombre: string; vivo: boolean; detalle: string }

export const api = {
  saludo: () => invoke<Saludo>("saludo"),
  serviciosArrancar: () => invoke<void>("servicios_arrancar"),
  serviciosEstado: () => invoke<EstadoServicio[]>("servicios_estado"),
  serviciosLog: (desde: number) => invoke<string[]>("servicios_log", { desde }),
};
