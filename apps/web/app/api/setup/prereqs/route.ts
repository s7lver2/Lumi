// apps/web/app/api/setup/prereqs/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../../lib/db";

export async function GET() {
  const checks: { id: string; label: string; ok: boolean; detail: string }[] = [];
  try {
    const { rows } = await getPool().query<{ extname: string }>(
      `SELECT extname FROM pg_extension WHERE extname IN ('vector','postgis')`
    );
    const names = rows.map((r) => r.extname);
    checks.push({ id: "postgres", label: "PostgreSQL", ok: true, detail: "conectado" });
    checks.push({ id: "pgvector", label: "pgvector", ok: names.includes("vector"), detail: names.includes("vector") ? "instalada" : "falta (se crea en el paso de migraciones)" });
    checks.push({ id: "postgis", label: "PostGIS", ok: names.includes("postgis"), detail: names.includes("postgis") ? "instalada" : "falta (se crea en el paso de migraciones)" });
  } catch (e) {
    checks.push({ id: "postgres", label: "PostgreSQL", ok: false, detail: `no conecta: ${e instanceof Error ? e.message : String(e)}` });
  }
  const infUrl = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(`${infUrl}/docs`, { signal: AbortSignal.timeout(2000) });
    checks.push({ id: "inference", label: "Servicio de inferencia", ok: res.ok, detail: res.ok ? "alcanzable" : `HTTP ${res.status}` });
  } catch {
    checks.push({ id: "inference", label: "Servicio de inferencia", ok: false, detail: "no alcanzable (se instala/arranca en el paso de dependencias)" });
  }
  return NextResponse.json({ checks });
}