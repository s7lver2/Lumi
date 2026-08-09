import { invoke } from "@tauri-apps/api/core";

export interface Saludo { version: string; so: string; dir: string }
export interface Gpu { nombre: string; util_pct: number; vram_usada_mb: number; vram_total_mb: number }
export interface Rendimiento { gpus: Gpu[] }
export interface EstadoServicio { nombre: string; vivo: boolean; detalle: string; propio: boolean }
export interface Diagnostico {
  so: string;
  redis_en_path: boolean;
  qdrant_en_path: boolean;
  wsl_responde: boolean | null;
  redis_puerto: number;
  qdrant_puerto: number;
  estado: EstadoServicio[];
}
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
export interface DetalleIndice {
  nombre: string; slug: string; estado: string;
  imagenes: PorcentajesImagenes; trabajo: [string, number, number][];
}
export interface LoteResumen { id: number; clase: string; origen: string; estado: string }
export interface FichaMapa {
  id: number; ruta: string; lat: number; lng: number; fuente: string;
  capturada_en: string | null; ancho: number | null; alto: number | null;
  licencia: string | null; rumbo: number | null;
}

export interface CodigoDispositivo { codigo: string; url: string; intervalo: number }
export interface Sesion {
  proveedor: string; cuenta: string; avatar: string;
  desde: string; huella: string; permisos: string[];
}

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
export interface ProgresoSellado {
  etapa: string;
  hechos: number;
  total: number;
  terminado: boolean;
  informe: Informe | null;
  error: string | null;
}

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
export interface ProgresoSondeo {
  resultados: SondeoTesela[];
  hechos: number;
  total: number;
  terminado: boolean;
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
export interface LineaOrigen {
  fuente: string; hechas: number; total: number; imagenes: number; coste_eur: number;
}
export interface PlanDescarga {
  indice_id: number;
  nuevas: Record<string, string[]>;
  presupuesto_eur: number;
  imagenes_estimadas: number;
}
export interface PlanPendiente { plan: PlanDescarga; nombre_indice: string }
export interface TeselaProgreso { quadkey: string; fuente: string; hecha: boolean }
export interface TeselaEnCurso { quadkey: string; fuente: string; imagenes: number; objetivo: number }
export interface ProgresoDescarga {
  trabajando: boolean;
  teselas_hechas: number;
  teselas_total: number;
  imagenes: number;
  gastado_eur: number;
  sin_saldo: boolean;
  por_origen: LineaOrigen[];
  teselas: TeselaProgreso[];
  en_curso: TeselaEnCurso | null;
  ultimo: string;
  registro: string[];
}
export interface FichaRevision { id: number; ruta: string; fuente: string; licencia: string | null }
export interface Cuentas { pendientes: number; aceptadas: number; rechazadas: number }
export interface Publicable { fuente: string; en_el_indice: number; viajan: number; licencia: string; motivo: string }

export interface ProgresoIngesta {
  trabajando: boolean;
  etapa: string;
  hechas: number;
  total: number;
  terminado: boolean;
  error: string | null;
  resumen: Resumen | null;
}

export interface ProgresoCola {
  modelo_id: string;
  trabajando: boolean;
  pausada: boolean;
  indice_actual: number | null;
  hechas: number;
  total: number;
  indice_hechas: number;
  indice_total: number;
  dispositivo: string;
  saltadas: number;
  reinicios: number;
  guardado_fallos: number;
}
export interface CodigoDispositivo { codigo: string; url: string; intervalo: number }
export interface Sesion {
  proveedor: string; cuenta: string; avatar: string;
  desde: string; huella: string; permisos: string[];
}
export interface ProgresoIndiceEmbed {
  modelo_id: string;
  hechas: number;
  total: number;
  activo: boolean;
  lote_hechas: number;
  lote_total: number;
  pausada: boolean;
  guardado_fallos: number;
}

export const api = {
  saludo: () => invoke<Saludo>("saludo"),
  rendimientoLeer: () => invoke<Rendimiento>("rendimiento_leer"),
  serviciosArrancar: () => invoke<void>("servicios_arrancar"),
  serviciosArrancarWsl: () => invoke<void>("servicios_arrancar_wsl"),
  serviciosParar: () => invoke<void>("servicios_parar"),
  serviciosEstado: () => invoke<EstadoServicio[]>("servicios_estado"),
  serviciosLog: (desde: number) => invoke<string[]>("servicios_log", { desde }),
  serviciosDiagnostico: () => invoke<Diagnostico>("servicios_diagnostico"),
  debugLogLeer: () => invoke<string>("debug_log_leer"),
  setupCompleto: () => invoke<boolean>("setup_completo"),
  setupMarcarCompleto: () => invoke<void>("setup_marcar_completo"),
  setupReiniciar: () => invoke<void>("setup_reiniciar"),
  modelosLista: () => invoke<Modelo[]>("modelos_lista"),
  runtimeListo: () => invoke<boolean>("runtime_listo"),
  runtimeInstalar: () => invoke<void>("runtime_instalar"),
  ingestaCarpeta: (indiceId: number, ruta: string, tipo: string, fuente: string, licencia: string | null) =>
    invoke<Resumen>("ingesta_carpeta", { indiceId, ruta, tipo, fuente, licencia }),
  ingestaLegacyArrancar: (indiceId: number, ruta: string, tipo: string, fuente: string, declarada: boolean) =>
    invoke<void>("ingesta_legacy_arrancar", { indiceId, ruta, tipo, fuente, declarada }),
  ingestaLegacyProgreso: () => invoke<ProgresoIngesta>("ingesta_legacy_progreso"),
  indiceCrear: (nombre: string) => invoke<number>("indice_crear", { nombre }),
  indicesLista: () => invoke<ResumenIndice[]>("indices_lista"),
  indiceDetalle: (id: number) => invoke<DetalleIndice>("indice_detalle", { id }),
  indiceLotes: (id: number) => invoke<LoteResumen[]>("indice_lotes", { id }),
  loteCancelar: (id: number) => invoke<boolean>("lote_cancelar", { id }),
  indiceBorrar: (id: number) => invoke<void>("indice_borrar", { id }),
  indiceImagenes: (id: number) => invoke<FichaMapa[]>("indice_imagenes", { id }),
  territorioClasificar: (poligono: Punto[], fuentes: string[]) =>
    invoke<Clasificacion>("territorio_clasificar", { poligono, fuentes }),
  territorioHeredar: (indiceId: number, heredadas: [string, string, string][]) =>
    invoke<void>("territorio_heredar", { indiceId, heredadas }),
  mapboxClaveGuardar: (clave: string) => invoke<void>("mapbox_clave_guardar", { clave }),
  mapboxClave: () => invoke<string | null>("mapbox_clave_leer"),
  paqueteSellarArrancar: (indiceId: number, destino: string) =>
    invoke<void>("paquete_sellar_arrancar", { indiceId, destino }),
  paqueteSellarProgreso: () => invoke<ProgresoSellado>("paquete_sellar_progreso"),
  paqueteQueViaja: (indiceId: number) => invoke<Publicable[]>("paquete_que_viaja", { indiceId }),
  paqueteAbrir: (ruta: string) => invoke<void>("paquete_abrir", { ruta }),

  origenesLista: () => invoke<FichaOrigen[]>("origenes_lista"),
  sondearAreaArrancar: (teselas: string[]) => invoke<void>("sondear_area_arrancar", { teselas }),
  sondearAreaProgreso: () => invoke<ProgresoSondeo>("sondear_area_progreso"),
  estimarArea: (nuevas: Record<string, string[]>) =>
    invoke<Estimacion>("estimar_area", { nuevas }),
  claveLeer: (proveedor: string) => invoke<string | null>("clave_leer", { proveedor }),

  descargaArrancar: (
    indiceId: number, nuevas: Record<string, string[]>, presupuestoEur: number, imagenesEstimadas: number,
  ) => invoke<void>("descarga_arrancar", { indiceId, nuevas, presupuestoEur, imagenesEstimadas }),
  descargaProgreso: () => invoke<ProgresoDescarga>("descarga_progreso"),
  descargaPendiente: () => invoke<PlanPendiente | null>("descarga_pendiente"),
  descargaPendienteDescartar: () => invoke<void>("descarga_pendiente_descartar"),
  descargaParar: () => invoke<void>("descarga_parar"),
  revisionPendientes: (indiceId: number) => invoke<FichaRevision[]>("revision_pendientes", { indiceId }),
  revisionRechazar: (indiceId: number, ids: number[]) =>
    invoke<Cuentas>("revision_rechazar", { indiceId, ids }),
  revisionAceptarResto: (indiceId: number) => invoke<Cuentas>("revision_aceptar_resto", { indiceId }),
  colaProgreso: () => invoke<ProgresoCola[]>("cola_progreso"),
  colaPausar: (pausada: boolean) => invoke<void>("cola_pausar", { pausada }),
  indiceProgresoEmbebido: (id: number) => invoke<ProgresoIndiceEmbed[]>("indice_progreso_embebido", { id }),

  claveGuardar: (proveedor: string, clave: string) =>
    invoke<void>("clave_guardar", { proveedor, clave }),
  claveHay: (proveedor: string) => invoke<boolean>("clave_hay", { proveedor }),
  topeLeer: () => invoke<number>("tope_leer"),
  topeFijar: (eur: number) => invoke<void>("tope_fijar", { eur }),
  identidadArrancar: (proveedor: string) => invoke<CodigoDispositivo>("identidad_arrancar", { proveedor }),
  identidadSondear: () => invoke<Sesion | null>("identidad_sondear"),
  identidadLeer: () => invoke<Sesion | null>("identidad_leer"),
  identidadCerrar: () => invoke<void>("identidad_cerrar"),
  identidadRespaldo: () => invoke<string[]>("identidad_respaldo"),
  identidadRotar: () => invoke<string[]>("identidad_rotar"),
  gastoMes: () => invoke<[number, [string, number, number][]]>("gasto_mes"),

};
