import { invoke } from "@tauri-apps/api/core";

export interface Image {
  id: number; case_id: number; filename: string; bytes: number;
  width: number | null; height: number | null; mime: string;
  /** GPS DECLARADO por la cámara. Nunca se mezcla con el inferido. */
  exif_lat: number | null; exif_lng: number | null;
  exif: Record<string, string> | null;
  created_at: number;
}

export interface Capability { id: string; label: string; state: "on" | "partial" | "off"; reason: string | null }
export interface GpuInfo { index: number; name: string; vram_total_mb: number; pcie: string }
export interface GpuSample {
  index: number; util_pct: number; vram_used_mb: number; vram_total_mb: number;
  temp_c: number | null; clock_mhz: number | null; fan_pct: number | null;
  power_draw_mw: number | null;
}
export interface PuntoCurva { temp_c: number; valor: number }
export interface RangoFabrica { potencia_min_w: number; potencia_max_w: number; temp_throttle_c: number | null }
export interface HardwareProfile {
  potencia_w: number; offset_nucleo_mhz: number; offset_memoria_mhz: number;
  curva_ventilador: PuntoCurva[];
}
export interface HardwareDevice {
  index: number; name: string; sample: GpuSample; rango: RangoFabrica;
  perfil: HardwareProfile | null;
}
export interface PatchHardwareReq {
  potencia_w?: number; offset_nucleo_mhz?: number; offset_memoria_mhz?: number;
  curva_ventilador?: PuntoCurva[]; confirmado?: boolean;
}
export interface CpuCoreSample { indice: number; temp_c: number | null; uso_pct: number }
export interface CpuSample { nucleos: CpuCoreSample[]; potencia_w: number | null }
export interface CpuRango { potencia_min_w: number; potencia_max_w: number; aproximado: boolean }
export interface CpuProfile { pl1_w: number; pl2_w: number }
export interface CpuDevice {
  fabricante: "intel" | "amd" | "otro"; sample: CpuSample; rango: CpuRango;
  perfil: CpuProfile | null;
}
export interface PatchCpuReq { pl1_w?: number; pl2_w?: number; confirmado?: boolean }
export interface AvisoInfo {
  id: number;
  /** Documento JSON de Tiptap — opaco para el resto del cliente, solo lo
   *  entiende `AvisoEditor`. */
  contenido: unknown;
  icono: string;
  prioridad: "normal" | "urgente";
  destino: "todos" | "admins" | "personas";
  creado_por: string;
  created_at: number;
}
export interface CrearAvisoReq {
  contenido: unknown;
  icono: string;
  prioridad: "normal" | "urgente";
  destino: "todos" | "admins" | "personas";
  usuarios: string[];
}
export interface Sample {
  gpus: GpuSample[];
  cpu_pct: number;
  ram_used_mb: number;
  disk_free_mb: number;
  queue_depth: number;
  queue_paused: boolean;
  maintenance: boolean;
  maintenance_message: string;
  avisos: AvisoInfo[];
}
export interface LoginRes {
  token: string;
  username: string;
  is_admin: boolean;
  must_change_password: boolean;
}
export interface Limits {
  models: string[];
  max_concurrent: number;
  max_daily: number;
  max_storage_gb: number;
  queue_priority: number;
  can_create_projects: boolean;
  /** Si su trabajo pendiente sigue avanzando cuando se desconecta. */
  background_jobs: boolean;
}
export interface AccessStatus { status: "pending" | "approved" | "rejected"; display_name: string; reason: string | null }
export interface AdminRequest {
  id: number; display_name: string; message: string; source_ip: string;
  /** Lo que declaró el cliente al pedir acceso. `null` en las anteriores a
   *  que esto existiera. */
  device: string | null;
  external: boolean; status: string; reason: string | null;
  created_at: number; expires_at: number;
}
export interface SessionInfo {
  public_id: string; device_name: string | null; os: string | null;
  created_at: number; last_seen: number; current: boolean;
}
export interface ApiKeyInfo {
  public_id: string; label: string; prefix: string;
  owner_username: string; owner_is_service: boolean;
  created_at: number; last_seen: number; expires_at: number | null;
  ips: string[]; devices: string[];
}
export interface IssuedApiKey { key: string; info: ApiKeyInfo }
export interface SecuritySettings {
  zero_trust: boolean; self_service_ip: boolean;
  allowlist: string[]; denylist: string[];
  maintenance: boolean; maintenance_message: string;
  maintenance_block_login: boolean; maintenance_services: string[];
}
export interface DeviceRow { name: string; os: string | null; first_seen: number; last_seen: number }
export interface AdminUser {
  id: number; username: string; display_name: string | null; is_admin: boolean;
  blocked: boolean; must_change_password: boolean; created_at: number; limits: Limits;
}
export interface UserDetail {
  user: AdminUser; global: Limits;
  overrides: Record<string, unknown>;
  devices: DeviceRow[]; sessions: SessionInfo[];
}
export interface TaskStatus {
  id: string;
  kind: "inference_runtime" | "database" | "model_download";
  running: boolean;
  exit_code: number | null;
  log_len: number;
}
export interface ProviderTokenState {
  has_token: boolean;
}
export interface Resolucion {
  recuperacion_instalados: number;
  recuperacion_total: number;
  geometricos_instalados: number;
  geometricos_total: number;
  faltan: string[];
}
export interface NivelEstado {
  id: string;
  nombre: string;
  resolucion: Resolucion;
}
export interface MetaPeso {
  id: string;
  nombre: string;
  licencia: string;
  licencia_texto: string;
  puerta: string | null;
}
export interface TareaModelo {
  id: string;
  item_actual: string | null;
  pct: number | null;
}
export interface Hello {
  version: string;
  state: "unclaimed" | "claimed" | "provisioning" | "ready";
  mode: "native" | "docker";
  locked: boolean;
  fingerprint: string;
  capabilities: Capability[];
  gpus: GpuInfo[];
}

/** `lumi1_<host:puerto>_<huella>_<secreto>`. Se parte desde la derecha porque
 *  el campo de dirección lleva puntos y dos puntos. */
export function addrFromKey(key: string): string {
  const rest = key.trim().replace(/^lumi1_/, "");
  const parts = rest.split("_");
  return parts.length >= 3 ? parts.slice(0, -2).join("_") : "";
}

/** `lumi1s_<host:puerto>_<huella>`. Se parte desde la derecha: la dirección
 *  lleva puntos y dos puntos. */
export function addrFromCard(card: string): string {
  const rest = card.trim().replace(/^lumi1s_/, "");
  const i = rest.lastIndexOf("_");
  return i > 0 ? rest.slice(0, i) : "";
}
export function fingerprintFromCard(card: string): string {
  const rest = card.trim().replace(/^lumi1s_/, "");
  const i = rest.lastIndexOf("_");
  return i > 0 ? rest.slice(i + 1) : "";
}
export function isCard(s: string): boolean {
  return s.trim().startsWith("lumi1s_");
}

export interface Project {
  id: number; name: string; role: "owner" | "member";
  cases: number; images: number; bytes: number;
  created_at: number; updated_at: number;
}
export interface ProjectMember {
  user_id: number; username: string; role: "owner" | "member";
  status: "pending" | "accepted"; added_at: number;
}
export interface Invite {
  project_id: number; project_name: string; invited_by: string; added_at: number;
}
export interface UserSummary { id: number; username: string }
export interface ProjectImage extends Image {
  case_name: string;
}
export interface Case {
  id: number; project_id: number; name: string;
  images: number; analyses: number; resolved: number;
  lat: number | null; lng: number | null; created_at: number;
}
export interface Hipotesis {
  lat: number; lng: number; radio_m: number;
  /** No es una probabilidad: cuánto pesa este grupo frente a los demás. */
  peso: number;
  indice: string; autor: string;
  /** Cuántas correspondencias sostienen esta coordenada. `null` significa que
   *  no pasó por verificación geométrica, no que sacara cero. */
  inliers: number | null;
  verificador: string | null;
  /** Por qué un agente hundió esta hipótesis. `null` significa que ninguno la
   *  tocó, no que la aprobaran. */
  motivo_agente: string | null;
}
/** Un veredicto de agente tal como se guardó. `etiqueta` vale `"abstiene"`
 *  cuando el agente corrió y no vio señal suficiente. */
export interface DichoDeAgente {
  agente: string; nombre: string; etiqueta: string;
  confianza: number;
  tipo: "filtra" | "describe";
  detalle: string;
}
export interface Analysis {
  id: number; case_id: number; model: string;
  state: "pendiente" | "en_curso" | "hecho" | "error";
  error: string | null;
  result_lat: number | null; result_lng: number | null;
  result_radius_m: number | null; result_confidence: number | null;
  /** Las alternativas. La principal NO está aquí, sigue en result_*. */
  hypotheses: Hipotesis[];
  /** El nivel que realmente corrió si hubo descenso por capas que faltaban.
   *  `null` significa «el que se pidió». */
  nivel_efectivo: string | null;
  /** Lo que los agentes dijeron de la imagen. Vacía si no corrió ninguno. */
  agentes: DichoDeAgente[];
  image_ids: number[]; created_at: number; finished_at: number | null;
}
export interface Usage { used_bytes: number; limit_gb: number; overridden: boolean }
export interface IndiceInstalado {
  paquete: string; nombre: string; autor: string;
  teselas: number; bytes: number; modelo: string; version: string; completo: boolean;
}
export interface ProgresoInstalacion {
  paquete: string; asset: string; hechos: number; total: number;
  registro: string[]; terminado: boolean; error: string | null; rotas: string[];
}
/** Lo que `/v1/auth/me` contesta. Los límites vienen aquí para que la interfaz
 *  sepa desde el primer render qué puede ofrecer habilitado. */
export interface Me { username: string; is_admin: boolean; limits: Limits }
export interface MapConfig {
  provider: "mapbox" | "osm" | "none"; theme: string | null;
  has_key: boolean; reason: string | null;
  /** Quién dibuja. `maplibre` no deja salir la clave del servidor; `mapbox`
   *  la necesita aquí, porque su SDK firma las peticiones en el navegador. */
  engine: "maplibre" | "mapbox";
  /** Solo con `engine: "mapbox"`. Con el otro motor siempre `null`. */
  key: string | null;
  /** El estilo sin reescribir, solo con `engine: "mapbox"`. */
  style: string | null;
}
export interface MapTheme { id: string; label: string; needs_key: boolean }
export interface WorkerView {
  dispositivo: string;
  /** El modelo cargado ahora mismo. `null` mientras arranca o entre cambios. */
  modelo: string | null;
  /** El análisis que tiene en la mano, si tiene alguno. */
  trabajo: number | null;
  /** Si ya dijo `listo`. Uno que no lo ha dicho está cargando, no colgado. */
  listo: boolean;
}
export interface QueueView { pendientes: number; en_curso: number; trabajadores: WorkerView[] }

/** Lo que llega por el evento `queue-change`. El progreso no está guardado en
 *  ninguna parte: se emite y se olvida, así que si te lo pierdes, se perdió. */
export type Cambio =
  | { tipo: "estado"; analysis_id: number; case_id: number; estado: Analysis["state"] }
  | { tipo: "progreso"; analysis_id: number; fase: string; pct: number };

export interface Resumen {
  solicitudes_pendientes: number;
  /** Epoch de la más antigua sin resolver. `null` si no hay ninguna. */
  solicitud_mas_antigua: number | null;
  usuarios: number;
  usuarios_conectados: number;
  analisis_hoy: number;
  analisis_en_cola: number;
  /** Siete días, el más reciente al final. */
  analisis_serie: number[];
  indices: number;
  indices_bytes: number;
  teselas: number;
  arrancado_en: number;
}

const call = (method: string, path: string, body: unknown, token?: string, ticket?: string) =>
  invoke<string>("request", {
    method, path, body: body === undefined ? null : JSON.stringify(body), token, ticket,
  });

export const api = {
  pair: (key: string) => invoke<Hello>("pair", { key }),
  pairCard: (card: string) => invoke<Hello>("pair_card", { card }),
  /** Reestablece el cliente TLS anclado sin la clave original (ya gastada):
   *  basta con la dirección y la huella persistidas. */
  reconnect: (addr: string, fingerprint: string) => invoke<Hello>("reconnect", { addr, fingerprint }),
  get: <T>(path: string, token?: string) => call("GET", path, undefined, token).then(t => JSON.parse(t) as T),
  post: <T>(path: string, body: unknown, token?: string) =>
    call("POST", path, body, token).then(t => (t ? (JSON.parse(t) as T) : (null as T))),
  patch: <T>(path: string, body: unknown, token?: string) =>
    call("PATCH", path, body, token).then(t => (t ? (JSON.parse(t) as T) : (null as T))),
  del: (path: string, token?: string) => call("DELETE", path, undefined, token).then(() => undefined),
  ticketGet: <T>(path: string, ticket: string) =>
    call("GET", path, undefined, undefined, ticket).then(t => JSON.parse(t) as T),
  ticketPost: <T>(path: string, body: unknown, ticket: string) =>
    call("POST", path, body, undefined, ticket).then(t => (t ? (JSON.parse(t) as T) : (null as T))),
  hardwareListar: (token: string) => api.get<HardwareDevice[]>("/v1/admin/hardware", token),
  hardwareAplicar: (index: number, req: PatchHardwareReq, token: string) =>
    api.patch<HardwareDevice>(`/v1/admin/hardware/${index}`, req, token),
  cpuLeer: (token: string) => api.get<CpuDevice>("/v1/admin/hardware/cpu", token),
  cpuAplicar: (req: PatchCpuReq, token: string) => api.patch<CpuDevice>("/v1/admin/hardware/cpu", req, token),
};