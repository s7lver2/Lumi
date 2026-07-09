// apps/web/app/api/setup/prereqs/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../lib/db";

export async function GET() {
  const checks: { id: string; ok: boolean; detail: string }[] = [];
  // Postgres + extensions
  try {
    const { rows } = await getPool().query(
      `SELECT extname FROM pg_extension WHERE extname IN ('vector','postgis')`
    );
    const names = rows.map((r) => r.extname);
    checks.push({ id: "postgres", ok: true, detail: "conectado" });
    checks.push({ id: "pgvector", ok: names.includes("vector"), detail: names.includes("vector") ? "instalada" : "falta la extensión vector" });
    checks.push({ id: "postgis", ok: names.includes("postgis"), detail: names.includes("postgis") ? "instalada" : "falta la extensión postgis" });
  } catch (e) {
    checks.push({ id: "postgres", ok: false, detail: `no conecta: ${e instanceof Error ? e.message : e}` });
  }
  // Inference service reachable
  const infUrl = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(`${infUrl}/docs`, { signal: AbortSignal.timeout(2000) });
    checks.push({ id: "inference", ok: res.ok, detail: res.ok ? "alcanzable" : `HTTP ${res.status}` });
  } catch {
    checks.push({ id: "inference", ok: false, detail: "no alcanzable (arráncalo en el paso de dependencias)" });
  }
  return NextResponse.json({ checks });
}