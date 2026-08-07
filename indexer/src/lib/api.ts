import { invoke } from "@tauri-apps/api/core";

export interface Saludo { version: string; so: string; dir: string }
export interface EstadoServicio { nombre: string; vivo: boolean; detalle: string; propio: boolean }
export interface Modelo { id: string; nombre: string; base: string; version: string; dims: number; pesos_url: string }
export interface Resumen { lote_id: number; aceptadas: number; saltadas: number; con_vector: number; motivos: string[] }

export type Tipo = "calle" | "cenital" | "suelta";
export interface PctTipo { tipo: Tipo; imagenes: number; imagenes_pct: number; teselas: number; territorio_pct: number }
export interface PctFuente { fuente: string; imagenes: number; imagenes_pct: number }
export interface PorcentajesImagenes {
  por_tipo: PctTipo[];
  por_fuente: PctFuente[];
  imagenes_total: number;
  teselas_total: number;
  territorio_suma: number;
}
export interface ResumenIndice {
  id: number; nombre: string; slug: string; estado: string;
  imagenes: number; teselas: number; imagenes_pct: PorcentajesImagenes;
}
export interface DetalleIndice { imagenes: PorcentajesImagenes; trabajo: [string, number, number][] }
export interface LoteResumen { id: number; clase: string; origen: string; estado: string }

export interface Punto { lat: number; lng: number }
export type EstadoTesela =
  | { estado: "local"; indice: string; sha256: string }
  | { estado: "catalogo"; indice: string; sha256: string; bytes: number; atribucion: { autor: string; url: string; licencia: string } }
  | { estado: "nuevo" };
export interface Clasificacion {
  teselas: [string, EstadoTesela][];
  locales: number;
  catalogo: number;
  nuevas: number;
  bytes_a_descargar: number;
  autores: [string, number][];
}

export interface Informe { filas: number; por_modelo: [string, number, number][]; cuadra: boolean }

export const api = {
  saludo: () => invoke<Saludo>("saludo"),
  serviciosArrancar: () => invoke<void>("servicios_arrancar"),
  serviciosArrancarWsl: () => invoke<void>("servicios_arrancar_wsl"),
  serviciosParar: () => invoke<void>("servicios_parar"),
  serviciosEstado: () => invoke<EstadoServicio[]>("servicios_estado"),
  serviciosLog: (desde: number) => invoke<string[]>("servicios_log", { desde }),
  modelosLista: () => invoke<Modelo[]>("modelos_lista"),
  runtimeListo: () => invoke<boolean>("runtime_listo"),
  runtimeInstalar: () => invoke<void>("runtime_instalar"),
  ingestaCarpeta: (indiceId: number, ruta: string, tipo: string, fuente: string, licencia: string | null) =>
    invoke<Resumen>("ingesta_carpeta", { indiceId, ruta, tipo, fuente, licencia }),
  ingestaLegacy: (indiceId: number, ruta: string, tipo: string, fuente: string, declarada: boolean) =>
    invoke<Resumen>("ingesta_legacy", { indiceId, ruta, tipo, fuente, declarada }),
  indicesLista: () => invoke<ResumenIndice[]>("indices_lista"),
  indiceDetalle: (id: number) => invoke<DetalleIndice>("indice_detalle", { id }),
  indiceLotes: (id: number) => invoke<LoteResumen[]>("indice_lotes", { id }),
  territorioClasificar: (poligono: Punto[]) => invoke<Clasificacion>("territorio_clasificar", { poligono }),
  mapboxClaveGuardar: (clave: string) => invoke<void>("mapbox_clave_guardar", { clave }),
  mapboxClave: () => invoke<string | null>("mapbox_clave_leer"),
  paqueteSellar: (indiceId: number, destino: string) => invoke<Informe>("paquete_sellar", { indiceId, destino }),
  paqueteAbrir: (ruta: string) => invoke<void>("paquete_abrir", { ruta }),
};
