import { invoke } from "@tauri-apps/api/core";

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
export interface LoginRes { token: string; is_admin: boolean }
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

export const api = {
  pair: (key: string) => invoke<Hello>("pair", { key }),
  get: <T>(path: string, token?: string) =>
    invoke<string>("request", { method: "GET", path, body: null, token }).then(t => JSON.parse(t) as T),
  post: <T>(path: string, body: unknown, token?: string) =>
    invoke<string>("request", { method: "POST", path, body: JSON.stringify(body), token })
      .then(t => (t ? (JSON.parse(t) as T) : (null as T))),
};
