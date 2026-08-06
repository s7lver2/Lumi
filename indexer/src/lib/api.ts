import { invoke } from "@tauri-apps/api/core";

export interface Saludo { version: string; so: string; dir: string }
export interface EstadoServicio { nombre: string; vivo: boolean; detalle: string }
export interface Modelo { id: string; nombre: string; base: string; version: string; dims: number; pesos_url: string }
export interface Resumen { lote_id: number; aceptadas: number; saltadas: number; con_vector: number; motivos: string[] }

export const api = {
  saludo: () => invoke<Saludo>("saludo"),
  serviciosArrancar: () => invoke<void>("servicios_arrancar"),
  serviciosEstado: () => invoke<EstadoServicio[]>("servicios_estado"),
  serviciosLog: (desde: number) => invoke<string[]>("servicios_log", { desde }),
  modelosLista: () => invoke<Modelo[]>("modelos_lista"),
  runtimeListo: () => invoke<boolean>("runtime_listo"),
  runtimeInstalar: () => invoke<void>("runtime_instalar"),
  ingestaCarpeta: (indiceId: number, ruta: string, tipo: string, fuente: string, licencia: string | null) =>
    invoke<Resumen>("ingesta_carpeta", { indiceId, ruta, tipo, fuente, licencia }),
  ingestaLegacy: (indiceId: number, ruta: string, tipo: string, fuente: string, declarada: boolean) =>
    invoke<Resumen>("ingesta_legacy", { indiceId, ruta, tipo, fuente, declarada }),
};
