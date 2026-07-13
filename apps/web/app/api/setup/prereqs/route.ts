// apps/web/app/api/setup/prereqs/route.ts
import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getPool } from "../../../../lib/db";

const execFileAsync = promisify(execFile);

const IS_WIN = process.platform === "win32";

// Informational only — never blocks Install. Detects whether WSL2 is present
// so the wizard can offer "install inference deps under WSL2" as an OPT-IN
// speed knob (romatch disables its fast local-correlation kernel outside
// Linux — confirmed live, RoMa/Laila verification is far slower on native
// Windows even with CUDA). This does NOT install WSL2 itself. Only
// meaningful on a Windows host — on native Linux there's nothing to opt
// into (you're already on Linux), and wsl.exe doesn't exist to spawn.
async function checkWsl(): Promise<{ id: string; label: string; ok: boolean; detail: string }> {
  if (!IS_WIN) {
    return { id: "wsl", label: "WSL2 (opcional)", ok: false, detail: "no aplica en Linux" };
  }
  try {
    await execFileAsync("wsl.exe", ["--status"], { timeout: 3000 });
    return { id: "wsl", label: "WSL2 (opcional)", ok: true, detail: "disponible" };
  } catch {
    return { id: "wsl", label: "WSL2 (opcional)", ok: false, detail: "no detectado — instálalo con `wsl --install` si quieres verificación más rápida" };
  }
}

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
  checks.push(await checkWsl());
  // Lets the wizard's InstallStep pick which runtime UI/step list to show
  // without re-deriving platform detection on the client.
  return NextResponse.json({ checks, platform: IS_WIN ? "windows" : "linux" });
}