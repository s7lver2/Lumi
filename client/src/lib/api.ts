import { invoke } from "@tauri-apps/api/core";

export interface Capability { id: string; label: string; state: "on" | "partial" | "off"; reason: string | null }
export interface GpuInfo { index: number; name: string; vram_total_mb: number; pcie: string }
export interface Hello {
  version: string;
  state: "unclaimed" | "claimed" | "provisioning" | "ready";
  mode: "native" | "docker";
  locked: boolean;
  fingerprint: string;
  capabilities: Capability[];
  gpus: GpuInfo[];
}

export const api = {
  pair: (key: string) => invoke<Hello>("pair", { key }),
  get: <T>(path: string, token?: string) =>
    invoke<string>("request", { method: "GET", path, body: null, token }).then(t => JSON.parse(t) as T),
  post: <T>(path: string, body: unknown, token?: string) =>
    invoke<string>("request", { method: "POST", path, body: JSON.stringify(body), token })
      .then(t => (t ? (JSON.parse(t) as T) : (null as T))),
};
