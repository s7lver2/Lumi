import type { Pool } from "pg";

export type ServiceStatus = "ready" | "loading" | "crashed";

/**
 * Loading vs. crashed is a simple elapsed-time heuristic (spec: docs/
 * superpowers/specs/2026-07-13-startup-health-screens-design.md's "Loading
 * vs. crashed" section) — not healthy right now, but within its startup
 * allowance since it was first observed unhealthy, is still "loading";
 * beyond the allowance, "crashed". `firstUnhealthyAtMs: null` means this is
 * the very first observation, treated as just-starting (loading).
 */
export function resolveServiceStatus(
  isHealthyNow: boolean,
  firstUnhealthyAtMs: number | null,
  nowMs: number,
  loadingAllowanceMs: number
): ServiceStatus {
  if (isHealthyNow) return "ready";
  if (firstUnhealthyAtMs === null) return "loading";
  return nowMs - firstUnhealthyAtMs < loadingAllowanceMs ? "loading" : "crashed";
}

/** Reuses the same /docs reachability check already used by the setup
 * wizard (apps/web/app/api/setup/run/[step]/route.ts's waitForInferenceReady). */
export async function checkInferenceReady(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/docs`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function checkWorkerHeartbeatFresh(pool: Pool, staleAfterMs: number): Promise<boolean> {
  const { rows } = await pool.query<{ updated_at: string }>(
    "SELECT updated_at FROM worker_heartbeat WHERE id = 1"
  );
  if (rows.length === 0) return false;
  const ageMs = Date.now() - new Date(rows[0].updated_at).getTime();
  return ageMs < staleAfterMs;
}

export interface ModelStatus {
  loading: "retrieval" | "verification" | null;
  lowVramMode: boolean;
  gpuNote: string;
}

/** Proxies the inference service's /model-status endpoint, falling back to
 * "nothing loading" on any failure (network error or non-ok response) —
 * an unreachable inference service isn't this route's concern (the boot
 * health screen already covers that). */
export async function fetchModelStatus(baseUrl: string): Promise<ModelStatus> {
  try {
    const res = await fetch(`${baseUrl}/model-status`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`inference /model-status returned ${res.status}`);
    return (await res.json()) as ModelStatus;
  } catch {
    return { loading: null, lowVramMode: false, gpuNote: "Estado de la GPU desconocido — servicio de inferencia no disponible." };
  }
}
