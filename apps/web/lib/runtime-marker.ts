// apps/web/lib/runtime-marker.ts
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getRepoRoot } from "./repo-root";

// tools/installer_source.py has no access to the settings repo (no Postgres
// connection, no encryption key) — it needs SOME way to know whether to
// launch services/inference via the native venv or venv-wsl before it has
// even started Postgres. A plain, non-secret JSON marker file (INFERENCE_RUNTIME
// is isSecret:false — see packages/shared-types/src/settings.ts) sidesteps
// that chicken-and-egg problem entirely: no DB round trip needed to decide
// how to launch things. Mirrored by tools/service_launcher.py's
// read_runtime_marker() — the "inferenceRuntime" key name must match on both sides.
export async function writeRuntimeMarker(runtime: string, repoRoot?: string): Promise<void> {
  // Must be the real repo checkout, not process.cwd()'s "../.." — see
  // repo-root.ts for why a packaged --testing run's cwd doesn't give that.
  const root = repoRoot ?? getRepoRoot();
  const dir = resolve(root, "data");
  await mkdir(dir, { recursive: true });
  await writeFile(
    resolve(dir, "runtime-config.json"),
    JSON.stringify({ inferenceRuntime: runtime }, null, 2)
  );
}