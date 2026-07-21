// apps/web/lib/repo-root.ts
import { resolve } from "node:path";

/**
 * The real repo checkout root — NOT reliably `process.cwd()`'s `"../.."`.
 * `tools/build.py release --testing` launches the compiled `server.js`
 * with cwd = the staging directory (`dist/lumi-<version>/apps/web`), and
 * `stage_bundle()` unconditionally `shutil.rmtree()`s that entire staging
 * directory at the START of every single build/rebuild — so any path
 * derived from `process.cwd()` and written to disk (backup snapshots,
 * locally-stored images, marker files, etc.) looks like a stable location
 * but silently gets wiped on the next rebuild (confirmed live: a Lumi
 * Preview reinstall's uninstall-snapshot metadata, and every downloaded
 * dataset's captured images, were both landing under
 * `dist/lumi-<version>/...` and vanishing on the next `tools/build.py`
 * run). `tools/build.py` sets `LUMI_REPO_ROOT` to the real, stable
 * checkout root specifically to route around this — first done for
 * `app/api/setup/run/[step]/route.ts`'s inference-venv check, which had
 * the identical bug. Dev mode (`next dev`) never sets it, but there
 * `process.cwd()` already IS the real repo checkout, so the fallback
 * covers that case correctly.
 */
export function getRepoRoot(): string {
  return process.env.LUMI_REPO_ROOT ?? resolve(process.cwd(), "..", "..");
}
