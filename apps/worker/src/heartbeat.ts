import type { Pool } from "pg";

/** Touches the singleton worker_heartbeat row so apps/web's /api/health can
 * tell the worker process is alive — the worker has no HTTP surface of its
 * own (spec: docs/superpowers/specs/2026-07-13-startup-health-screens-design.md). */
export async function touchHeartbeat(pool: Pool): Promise<void> {
  await pool.query("UPDATE worker_heartbeat SET updated_at = now() WHERE id = 1");
}

/** Touches immediately, then on a fixed interval. Caller (index.ts) owns the
 * returned handle for cleanup; nothing here ever clears it itself since the
 * worker process is meant to keep touching until it exits. */
export function startHeartbeatLoop(pool: Pool, intervalMs = 5000): NodeJS.Timeout {
  void touchHeartbeat(pool).catch((err) => console.error("heartbeat: initial touch failed:", err));
  return setInterval(() => {
    void touchHeartbeat(pool).catch((err) => console.error("heartbeat: touch failed:", err));
  }, intervalMs);
}
