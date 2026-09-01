import { invoke } from "@tauri-apps/api/core";

export interface Saludo { version: string; so: string; dir: string }
export interface ProgresoMigracion {
  trabajando: boolean;
  bytes_copiados: number;
  bytes_total: number;
  archivo_actual: string;
  terminado: boolean;
  error: string | null;
}
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
export interface Modelo {
  id: string; nombre: string; base: string; version: string; dims: number;
  familia: string; licencia: string; pesos_url: string; sha256: string;
  fichero_url: string; licencia_texto: string; puerta: string | null;
}
export interface ProgresoPesos {
  modelo_id: string; pct: number; mib: number; total_mib: number;
  terminado: boolean; error: string | null; registro: string[];
}
export interface Nivel {
  id: string; nombre: string;
  recuperacion: string[]; geometricos: string[]; agentes: string[];
  cae_a: string | null;
}
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
  publicado: boolean;
}
export interface DetalleIndice {
  nombre: string; slug: string; estado: string;
  imagenes: PorcentajesImagenes; trabajo: [string, number, number][];
  numero_version: number;
  /** El proyecto (repo de GitHub etiquetado `lumi-index`) al que pertenece —
   *  `null` en cualquier índice creado antes de la spec de pestaña de
   *  Proyectos. */
  proyecto: string | null;
}
/** Espejo de `lumi_index::manifest::TrabajoDe`: serde externamente etiquetado,
 *  así que la unidad es una cadena y las que llevan dato son un objeto de una
 *  clave. */
export type TrabajoDe = "Aqui" | { Local: string } | { Catalogo: string };
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
export interface RespuestaSondeo { sesion: Sesion | null; mas_despacio: boolean }

export interface Punto { lat: number; lng: number }
export type EstadoTesela =
  | { estado: "local"; indice: string; sha256: string }
  | { estado: "catalogo"; indice: string; sha256: string; bytes: number; atribucion: { autor: string; url: string; licencia: string } }
  | { estado: "nuevo" }
  | { estado: "reclamada"; paquete: string; autor: string };
export interface RepartoOrigen { locales: number; catalogo: number; nuevas: number }
export interface Clasificacion {
  teselas: [string, EstadoTesela][];
  locales: number;
  catalogo: number;
  nuevas: number;
  reclamadas: number;
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
export interface LugarReciente { nombre: string; lat: number; lng: number }
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
  ultimo_fallo: string | null;
  esperando_qdrant: boolean;
}
export interface FichaResumen {
  paquete: string; nombre: string; autor: string; url: string;
  teselas: number; viva: boolean; por_fuente: PctFuente[];
  capas: number; publicada_en: string; numero_version: number;
}
export interface Resultados { indices: FichaResumen[]; cuentas: string[] }
export interface Perfil {
  cuenta: string; publicaciones: FichaResumen[]; teselas: number;
  km2: number; quadkeys: string[];
}
export interface RepoRemoto { repo: string; paquetes: FichaResumen[] }
export interface PerfilGithub {
  avatar_url: string; nombre: string | null; bio: string | null;
  seguidores: number; url: string;
}
export interface CapaRemota {
  modelo: string; version: string; dims: number;
  autor: string; paquete: string; del_autor_del_cuerpo: boolean;
}
export interface DependenciaRota {
  indice_id: number; indice: string; paquete: string;
  autor: string; quadkeys: number; dias_caida: number;
}

export interface Repo { nombre: string; privado: boolean; tiene_etiqueta: boolean }
export interface Proyecto {
  repo: string; privado: boolean; indices: number; teselas: number;
  imagenes: number; ultima_actividad: number | null;
}
export interface TrozoPrevisto { zona: string; quadkeys: number; bytes: number }
export interface Previsualizacion {
  trozos: TrozoPrevisto[];
  bytes_total: number;
  no_redistribuibles: string[];
}
export interface ProgresoPublicacion {
  asset: string;
  hechos: number;
  total: number;
  bytes_hechos: number;
  bytes_total: number;
  terminado: boolean;
  error: string | null;
  registro: string[];
  detalle: string | null;
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
  ultimo_fallo: string | null;
  esperando_qdrant: boolean;
}

export const api = {
  saludo: () => invoke<Saludo>("saludo"),
  ubicacionLeer: () => invoke<string>("ubicacion_leer"),
  ubicacionPorDefecto: () => invoke<string>("ubicacion_por_defecto"),
  ubicacionMigrar: (destino: string) => invoke<void>("ubicacion_migrar", { destino }),
  ubicacionMigracionProgreso: () => invoke<ProgresoMigracion | null>("ubicacion_migracion_progreso"),
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
  modeloPesosDescargar: (modeloId: string) => invoke<void>("modelo_pesos_descargar", { modeloId }),
  modeloPesosProgreso: () => invoke<ProgresoPesos | null>("modelo_pesos_progreso"),
  runtimeListo: () => invoke<boolean>("runtime_listo"),
  runtimeInstalar: () => invoke<void>("runtime_instalar"),
  ingestaCarpeta: (indiceId: number, ruta: string, tipo: string, fuente: string, licencia: string | null) =>
    invoke<Resumen>("ingesta_carpeta", { indiceId, ruta, tipo, fuente, licencia }),
  /** Recorre las fotos que ya están en disco y les pide el vector del modelo
   *  que les falta: no descarga nada ni gasta presupuesto. */
  indiceReembeber: (indiceId: number, modelo: string) =>
    invoke<number>("indice_reembeber", { indiceId, modelo }),
  ingestaLegacyArrancar: (indiceId: number, ruta: string, tipo: string, fuente: string, declarada: boolean) =>
    invoke<void>("ingesta_legacy_arrancar", { indiceId, ruta, tipo, fuente, declarada }),
  ingestaLegacyProgreso: () => invoke<ProgresoIngesta>("ingesta_legacy_progreso"),
  indiceCrear: (nombre: string, niveles: string[], proyecto: string) =>
    invoke<number>("indice_crear", { nombre, niveles, proyecto }),
  /** Cambia el nivel objetivo de un índice ya creado — sellado o no. Devuelve
   *  los modelos nuevos que se encolaron para embeber. */
  indicePortearNivel: (indiceId: number, niveles: string[]) =>
    invoke<string[]>("indice_portear_nivel", { indiceId, niveles }),
  nivelesLista: () => invoke<Nivel[]>("niveles_lista"),
  indicesLista: () => invoke<ResumenIndice[]>("indices_lista"),
  indicesListaDeProyecto: (proyecto: string) =>
    invoke<ResumenIndice[]>("indices_lista_de_proyecto", { proyecto }),
  indiceDetalle: (id: number) => invoke<DetalleIndice>("indice_detalle", { id }),
  indiceLotes: (id: number) => invoke<LoteResumen[]>("indice_lotes", { id }),
  loteCancelar: (id: number) => invoke<boolean>("lote_cancelar", { id }),
  indiceBorrar: (id: number) => invoke<void>("indice_borrar", { id }),
  indiceImagenes: (id: number) => invoke<FichaMapa[]>("indice_imagenes", { id }),
  indiceTeselas: (id: number) => invoke<[string, TrabajoDe][]>("indice_teselas", { id }),
  teselaLiberar: (indiceId: number, quadkey: string) =>
    invoke<void>("tesela_liberar", { indiceId, quadkey }),
  territorioClasificar: (poligonos: Punto[][], fuentes: string[]) =>
    invoke<Clasificacion>("territorio_clasificar", { poligonos, fuentes }),
  territorioHeredar: (indiceId: number, heredadas: [string, string, string][]) =>
    invoke<void>("territorio_heredar", { indiceId, heredadas }),
  territorioRecientesLeer: () => invoke<LugarReciente[]>("territorio_recientes_leer"),
  territorioRecientesAnadir: (nombre: string, lat: number, lng: number) =>
    invoke<void>("territorio_recientes_anadir", { nombre, lat, lng }),
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
  colaConcurrenciaLeer: () => invoke<number>("cola_concurrencia_leer"),
  colaConcurrenciaFijar: (n: number) => invoke<void>("cola_concurrencia_fijar", { n }),
  colaConsumoLeer: () => invoke<boolean>("cola_consumo_leer"),
  colaConsumoFijar: (bajo: boolean) => invoke<void>("cola_consumo_fijar", { bajo }),
  indiceProgresoEmbebido: (id: number) => invoke<ProgresoIndiceEmbed[]>("indice_progreso_embebido", { id }),

  claveGuardar: (proveedor: string, clave: string) =>
    invoke<void>("clave_guardar", { proveedor, clave }),
  claveHay: (proveedor: string) => invoke<boolean>("clave_hay", { proveedor }),
  topeLeer: () => invoke<number>("tope_leer"),
  topeFijar: (eur: number) => invoke<void>("tope_fijar", { eur }),
  identidadArrancar: (proveedor: string) => invoke<CodigoDispositivo>("identidad_arrancar", { proveedor }),
  identidadSondear: () => invoke<RespuestaSondeo>("identidad_sondear"),
  identidadLeer: () => invoke<Sesion | null>("identidad_leer"),
  identidadCerrar: () => invoke<void>("identidad_cerrar"),
  identidadRespaldo: () => invoke<string[]>("identidad_respaldo"),
  identidadRotar: () => invoke<string[]>("identidad_rotar"),
  identidadRespaldoGuardar: (ruta: string, palabras: string[]) =>
    invoke<void>("identidad_respaldo_guardar", { ruta, palabras }),
  gastoMes: () => invoke<[number, [string, number, number][]]>("gasto_mes"),

  catalogoRefrescar: () => invoke<number>("catalogo_refrescar"),
  catalogoBuscar: (texto: string) => invoke<Resultados>("catalogo_buscar", { texto }),
  catalogoPerfil: (cuenta: string) => invoke<Perfil>("catalogo_perfil", { cuenta }),
  catalogoPerfilGithub: (cuenta: string) => invoke<PerfilGithub>("catalogo_perfil_github", { cuenta }),
  catalogoDependenciasRotas: () => invoke<DependenciaRota[]>("catalogo_dependencias_rotas"),
  catalogoCapas: () => invoke<CapaRemota[]>("catalogo_capas"),
  publicarCapaArrancar: (
    indiceId: number, cuerpoSha256: string, cuerpoPaquete: string, cuerpoAutor: string,
    cuerpoUrl: string, modelo: string, repo: string,
  ) => invoke<void>("publicar_capa_arrancar", {
    indiceId, cuerpoSha256, cuerpoPaquete, cuerpoAutor, cuerpoUrl, modelo, repo,
  }),
  catalogoMios: () => invoke<RepoRemoto[]>("catalogo_mios"),
  catalogoReclamos: (quadkeys: string[]) => invoke<unknown[]>("catalogo_reclamos", { quadkeys }),
  publicarRepos: () => invoke<Repo[]>("publicar_repos"),
  proyectosLista: () => invoke<Proyecto[]>("proyectos_lista"),
  proyectoCrear: (nombre: string, privado: boolean) =>
    invoke<Proyecto>("proyecto_crear", { nombre, privado }),
  publicarPrevisualizar: (indiceId: number) => invoke<Previsualizacion>("publicar_previsualizar", { indiceId }),
  publicarArrancar: (indiceId: number, repo: string, descargo: boolean) =>
    invoke<void>("publicar_arrancar", { indiceId, repo, descargo }),
  publicarProgreso: () => invoke<ProgresoPublicacion>("publicar_progreso"),
  publicarContinuar: (indiceId: number) => invoke<void>("publicar_continuar", { indiceId }),
};
