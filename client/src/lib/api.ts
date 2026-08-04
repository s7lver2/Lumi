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
export interface GpuSample { index: number; util_pct: number; vram_used_mb: number; vram_total_mb: number; temp_c: number | null }
export interface Sample {
  gpus: GpuSample[];
  cpu_pct: number;
  ram_used_mb: number;
  disk_free_mb: number;
  queue_depth: number;
  queue_paused: boolean;
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
}
export interface AccessStatus { status: "pending" | "approved" | "rejected"; display_name: string; reason: string | null }
export interface AdminRequest {
  id: number; display_name: string; message: string; source_ip: string;
  external: boolean; status: string; reason: string | null;
  created_at: number; expires_at: number;
}
export interface SessionInfo {
  public_id: string; device_name: string | null; os: string | null;
  created_at: number; last_seen: number; current: boolean;
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
  kind: "inference_runtime" | "database";
  running: boolean;
  exit_code: number | null;
  log_len: number;
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
export interface ProjectImage extends Image {
  case_name: string;
}
export interface Case {
  id: number; project_id: number; name: string;
  images: number; analyses: number; resolved: number;
  lat: number | null; lng: number | null; created_at: number;
}
export interface Analysis {
  id: number; case_id: number; model: string;
  state: "pendiente" | "en_curso" | "hecho" | "error";
  error: string | null;
  result_lat: number | null; result_lng: number | null;
  result_radius_m: number | null; result_confidence: number | null;
  image_ids: number[]; created_at: number; finished_at: number | null;
}
export interface Usage { used_bytes: number; limit_gb: number; overridden: boolean }
/** Lo que `/v1/auth/me` contesta. Los límites vienen aquí para que la interfaz
 *  sepa desde el primer render qué puede ofrecer habilitado. */
export interface Me { username: string; is_admin: boolean; limits: Limits }
export interface MapConfig {
  provider: "mapbox" | "osm" | "none"; style_url: string;
  has_key: boolean; reason: string | null;
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
};
