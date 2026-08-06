import { invoke } from "@tauri-apps/api/core";

export interface Saludo { version: string; so: string; dir: string }
export interface EstadoServicio { nombre: string; vivo: boolean; detalle: string }
export interface Modelo { id: string; nombre: string; base: string; version: string; dims: number; pesos_url: string }

export const api = {
  saludo: () => invoke<Saludo>("saludo"),
  serviciosArrancar: () => invoke<void>("servicios_arrancar"),
  serviciosEstado: () => invoke<EstadoServicio[]>("servicios_estado"),
  serviciosLog: (desde: number) => invoke<string[]>("servicios_log", { desde }),
  modelosLista: () => invoke<Modelo[]>("modelos_lista"),
  runtimeListo: () => invoke<boolean>("runtime_listo"),
  runtimeInstalar: () => invoke<void>("runtime_instalar"),
};
