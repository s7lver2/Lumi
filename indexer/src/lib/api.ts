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
export interface RepartoOrigen { locales: number; catalogo: number; nuevas: number }
export interface Clasificacion {
  teselas: [string, EstadoTesela][];
  locales: number;
  catalogo: number;
  nuevas: number;
  bytes_a_descargar: number;
  autores: [string, number][];
  por_origen: Record<string, RepartoOrigen>;
}

export interface Informe { filas: number; por_modelo: [string, number, number][]; cuadra: boolean }

export interface FichaOrigen {
  id: string;
  tipo: "calle" | "cenital" | "suelta";
  puntos_exactos: boolean;
  gratis: boolean;
  usd_por_mil: number;
  redistribuye: boolean;
}
export interface SondeoTesela {
  quadkey: string;
  fuente: string;
  nivel: "mucho" | "poco" | "nada";
  estimadas: number;
  del_cache: boolean;
}
export interface LineaPrevista {
  fuente: string;
  teselas: number;
  unidades: number;
  coste_eur: number;
}
export interface Estimacion {
  lineas: LineaPrevista[];
  total_eur: number;
  gastado_eur: number;
  tope_eur: number;
  cabe: boolean;
  exceso_eur: number;
}
export interface ProgresoDescarga {
  trabajando: boolean;
  teselas_hechas: number;
  teselas_total: number;
  imagenes: number;
  gastado_eur: number;
  sin_saldo: boolean;
  por_origen: [string, number, number][];
  ultimo: string;
}
export interface FichaRevision { id: number; ruta: string; fuente: string; licencia: string | null }
export interface Cuentas { pendientes: number; aceptadas: number; rechazadas: number }
export interface Publicable { fuente: string; en_el_indice: number; viajan: number; licencia: string; motivo: string }

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
  indiceCrear: (nombre: string) => invoke<number>("indice_crear", { nombre }),
  indicesLista: () => invoke<ResumenIndice[]>("indices_lista"),
  indiceDetalle: (id: number) => invoke<DetalleIndice>("indice_detalle", { id }),
  indiceLotes: (id: number) => invoke<LoteResumen[]>("indice_lotes", { id }),
  territorioClasificar: (poligono: Punto[], fuentes: string[]) =>
    invoke<Clasificacion>("territorio_clasificar", { poligono, fuentes }),
  territorioHeredar: (indiceId: number, heredadas: [string, string, string][]) =>
    invoke<void>("territorio_heredar", { indiceId, heredadas }),
  mapboxClaveGuardar: (clave: string) => invoke<void>("mapbox_clave_guardar", { clave }),
  mapboxClave: () => invoke<string | null>("mapbox_clave_leer"),
  paqueteSellar: (indiceId: number, destino: string) => invoke<Informe>("paquete_sellar", { indiceId, destino }),
  paqueteQueViaja: (indiceId: number) => invoke<Publicable[]>("paquete_que_viaja", { indiceId }),
  paqueteAbrir: (ruta: string) => invoke<void>("paquete_abrir", { ruta }),

  origenesLista: () => invoke<FichaOrigen[]>("origenes_lista"),
  sondearArea: (teselas: string[]) => invoke<SondeoTesela[]>("sondear_area", { teselas }),
  estimarArea: (nuevas: Record<string, string[]>) =>
    invoke<Estimacion>("estimar_area", { nuevas }),
  claveLeer: (proveedor: string) => invoke<string | null>("clave_leer", { proveedor }),

  descargaArrancar: (indiceId: number, nuevas: Record<string, string[]>, presupuestoEur: number) =>
    invoke<void>("descarga_arrancar", { indiceId, nuevas, presupuestoEur }),
  descargaProgreso: () => invoke<ProgresoDescarga>("descarga_progreso"),
  descargaParar: () => invoke<void>("descarga_parar"),
  revisionPendientes: (indiceId: number) => invoke<FichaRevision[]>("revision_pendientes", { indiceId }),
  revisionRechazar: (indiceId: number, ids: number[]) =>
    invoke<Cuentas>("revision_rechazar", { indiceId, ids }),
  revisionAceptarResto: (indiceId: number) => invoke<Cuentas>("revision_aceptar_resto", { indiceId }),

  claveGuardar: (proveedor: string, clave: string) =>
    invoke<void>("clave_guardar", { proveedor, clave }),
  claveHay: (proveedor: string) => invoke<boolean>("clave_hay", { proveedor }),
  topeLeer: () => invoke<number>("tope_leer"),
  topeFijar: (eur: number) => invoke<void>("tope_fijar", { eur }),
  gastoMes: () => invoke<[number, [string, number, number][]]>("gasto_mes"),
};
