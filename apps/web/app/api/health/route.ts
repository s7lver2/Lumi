import { NextResponse } from "next/server";
import { getPool } from "../../../lib/db";
import { checkInferenceReady, checkWorkerHeartbeatFresh, resolveServiceStatus } from "../../../lib/health";

// This route reads nothing from the request itself (no params, no headers()/
// cookies()), so Next's static-analysis treats it as eligible for build-time
// prerendering by default — confirmed live: the standalone build served one
// frozen response (whatever worker/inference status happened to be true at
// build time) forever, never re-checking the DB/inference service on later
// requests. Health/status must always run live per-request.
export const dynamic = "force-dynamic";

const INFERENCE_LOADING_ALLOWANCE_MS = 90_000;
const WORKER_LOADING_ALLOWANCE_MS = 20_000;
const WORKER_STALE_AFTER_MS = 15_000;

// Module-scope, not per-request: tracks when each service was FIRST observed
// unhealthy, across polls, so resolveServiceStatus can tell "just started"
// (loading) from "been down a while" (crashed). Resets to null the moment a
// service is healthy again.
let inferenceFirstUnhealthyAt: number | null = null;
let workerFirstUnhealthyAt: number | null = null;

export async function GET() {
  const now = Date.now();
  const inferenceBaseUrl = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";

  const [inferenceHealthy, workerHealthy] = await Promise.all([
    checkInferenceReady(inferenceBaseUrl),
    checkWorkerHeartbeatFresh(getPool(), WORKER_STALE_AFTER_MS),
  ]);

  inferenceFirstUnhealthyAt = inferenceHealthy ? null : (inferenceFirstUnhealthyAt ?? now);
  workerFirstUnhealthyAt = workerHealthy ? null : (workerFirstUnhealthyAt ?? now);

  return NextResponse.json({
    web: "ready" as const,
    worker: resolveServiceStatus(workerHealthy, workerFirstUnhealthyAt, now, WORKER_LOADING_ALLOWANCE_MS),
    inference: resolveServiceStatus(inferenceHealthy, inferenceFirstUnhealthyAt, now, INFERENCE_LOADING_ALLOWANCE_MS),
  });
}
