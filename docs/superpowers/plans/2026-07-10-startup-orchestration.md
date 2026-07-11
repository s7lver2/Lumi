# Startup Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Double-clicking `LumiInstaller.exe` starts every process Lumi needs — Postgres (Docker), the inference service (native Windows venv or WSL2, per `INFERENCE_RUNTIME`), the worker (pg-boss consumer), and the web app — instead of only Postgres + web. The setup wizard gets a final step that actually starts inference+worker and health-checks them, so "Finalizar setup" means "I confirmed this works," not just "I saved some settings."

**Architecture:** Two independent orchestration paths that both need to answer the same question ("start inference — windows venv or WSL2? — plus the worker, and confirm they're alive") but run in different processes: (1) `tools/installer_source.py`, a standalone script with **no Node/Next.js runtime available**, reads a small JSON marker file written at the end of setup to know which runtime to launch; (2) a new branch inside the existing setup-wizard SSE endpoint (`apps/web/app/api/setup/run/[step]/route.ts`), which already runs inside Next.js and can read `INFERENCE_RUNTIME` straight from the settings repo. The two are deliberately NOT unified into one shared implementation — one is Python, one is TypeScript, and the process-spawning primitives are different enough (`subprocess.Popen` + detached vs. Node `spawn` + `detached`/`unref`) that a shared abstraction would be thinner than the duplication it removes.

**Tech Stack:** Python stdlib only (`subprocess`, `urllib.request`, `json`, `pathlib` — no new pip dependency), Node `child_process.spawn`, existing SSE plumbing (`ReadableStream`, `useCommandRun`), existing `winPathToWsl` helper.

## Global Constraints

- No Python test files anywhere under `tools/` (standing preference from the installer/bundler plan — Python code here is verified by manually running it and reading its output, not pytest).
- `tools/install.py` must not exist; `tools/build.py`/`tools/installer_source.py`/`tools/lumi_paths.py` stay as-is except where a task below explicitly touches them.
- Vitest/TDD applies to every TypeScript file this plan adds or edits — write the failing test first per the skill's step pattern.
- Never invent a health/readiness endpoint on the inference service beyond what's already there — `GET /docs` (FastAPI's auto Swagger page) is the existing, already-used-elsewhere (`apps/web/app/api/setup/prereqs/route.ts:36-42`) reachability probe; reuse it rather than adding a new `/health` route to `services/inference/main.py`.
- The worker (`apps/worker`) has no HTTP surface and no heartbeat table — "is it up" is approximated as "the spawned process is still alive N seconds after launch," and every task touching this must say so in a comment, not pretend it's a real health check.
- `INFERENCE_RUNTIME`'s value only decides which **venv** launches `uvicorn` (native `services/inference/venv` vs. WSL `services/inference/venv-wsl`) — it does NOT change the URL anything else uses to reach the service. WSL2's default `localhostForwarding` means `http://localhost:8000` reaches a uvicorn bound to `0.0.0.0:8000` inside WSL exactly the same as a native Windows uvicorn. Do not add any WSL-specific URL/port logic anywhere in this plan.

---

### Task 1: Persist the chosen runtime to a plain marker file at setup completion

**Files:**
- Create: `apps/web/lib/runtime-marker.ts`
- Create: `apps/web/lib/runtime-marker.test.ts`
- Modify: `apps/web/app/setup/actions.ts`
- Modify: `apps/web/app/setup/actions.test.ts`

**Interfaces:**
- Produces: `writeRuntimeMarker(runtime: string, repoRoot?: string): Promise<void>` — writes `{"inferenceRuntime": runtime}` to `<repoRoot>/data/runtime-config.json` (repoRoot defaults to `resolve(process.cwd(), "..", "..")`, same derivation `apps/web/app/api/setup/run/[step]/route.ts:13` already uses from `apps/web`'s cwd). Creates the `data/` directory if missing (`mkdir(dir, { recursive: true })`) — `data/` is already `.gitignore`'d and already used for `models-cache`/`settings.key`, so no new gitignore entry needed.
- Consumes (Task 3): `tools/service_launcher.py`'s `read_runtime_marker(root)` reads the exact same file/shape — the JSON key MUST stay `inferenceRuntime` (camelCase) on both sides; do not rename on either end without updating the other.

- [ ] **Step 1: Write the failing test for `writeRuntimeMarker`**

```ts
// apps/web/lib/runtime-marker.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRuntimeMarker } from "./runtime-marker";

describe("writeRuntimeMarker", () => {
  let dir: string | undefined;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("writes {\"inferenceRuntime\": <value>} to data/runtime-config.json under repoRoot", async () => {
    dir = await mkdtemp(join(tmpdir(), "lumi-runtime-marker-"));
    await writeRuntimeMarker("wsl", dir);
    const written = JSON.parse(await readFile(join(dir, "data", "runtime-config.json"), "utf8"));
    expect(written).toEqual({ inferenceRuntime: "wsl" });
  });

  it("creates the data/ directory if it doesn't exist yet", async () => {
    dir = await mkdtemp(join(tmpdir(), "lumi-runtime-marker-"));
    // dir/data does not exist yet — writeRuntimeMarker must create it.
    await writeRuntimeMarker("windows", dir);
    const written = JSON.parse(await readFile(join(dir, "data", "runtime-config.json"), "utf8"));
    expect(written).toEqual({ inferenceRuntime: "windows" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netryx/web exec vitest run app/lib/runtime-marker.test.ts`
Expected: FAIL — `Cannot find module './runtime-marker'`

- [ ] **Step 3: Implement `writeRuntimeMarker`**

```ts
// apps/web/lib/runtime-marker.ts
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// tools/installer_source.py has no access to the settings repo (no Postgres
// connection, no encryption key) — it needs SOME way to know whether to
// launch services/inference via the native venv or venv-wsl before it has
// even started Postgres. A plain, non-secret JSON marker file (INFERENCE_RUNTIME
// is isSecret:false — see packages/shared-types/src/settings.ts) sidesteps
// that chicken-and-egg problem entirely: no DB round trip needed to decide
// how to launch things. Mirrored by tools/service_launcher.py's
// read_runtime_marker() — the "inferenceRuntime" key name must match on both sides.
export async function writeRuntimeMarker(runtime: string, repoRoot?: string): Promise<void> {
  const root = repoRoot ?? resolve(process.cwd(), "..", "..");
  const dir = resolve(root, "data");
  await mkdir(dir, { recursive: true });
  await writeFile(
    resolve(dir, "runtime-config.json"),
    JSON.stringify({ inferenceRuntime: runtime }, null, 2)
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @netryx/web exec vitest run app/lib/runtime-marker.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire it into `submitSetup`, mocked in its existing test**

Modify `apps/web/app/setup/actions.test.ts` — add the mock and assert the call, without changing the two existing tests' behavior:

```ts
// apps/web/app/setup/actions.test.ts (add near the top, after existing imports)
import { describe, it, expect, vi } from "vitest";
import { submitSetup } from "./actions";

vi.mock("../../lib/runtime-marker", () => ({ writeRuntimeMarker: vi.fn() }));
import { writeRuntimeMarker } from "../../lib/runtime-marker";
```

Add a third test to the existing `describe("submitSetup", ...)` block:

```ts
  it("writes the runtime marker file with the submitted INFERENCE_RUNTIME value", async () => {
    const repo = { completeSetup: vi.fn() };
    await submitSetup(
      repo as any,
      makeFormData({
        GOOGLE_MAPS_API_KEY: "AIzaSyTest",
        MAPBOX_TOKEN: "",
        MAX_AREA_KM2: "5",
        MAX_MONTHLY_BUDGET_USD: "50",
        MAX_CONCURRENT_REQUESTS: "10",
        STREET_VIEW_PRICE_PER_IMAGE_USD: "0.007",
        INFERENCE_RUNTIME: "wsl",
      })
    );
    expect(writeRuntimeMarker).toHaveBeenCalledWith("wsl");
  });
```

Run this new test first to confirm it fails (`writeRuntimeMarker` not called yet — `submitSetup` doesn't import it): `pnpm --filter @netryx/web exec vitest run app/setup/actions.test.ts` → FAIL (`expected "spy" to be called with...` / 0 calls).

- [ ] **Step 6: Implement the call site in `actions.ts`**

```ts
// apps/web/app/setup/actions.ts — add this import
import { writeRuntimeMarker } from "../../lib/runtime-marker";
```

Change `submitSetup`'s body (after building `writes`, before/alongside the validation loop — placed right after `await repo.completeSetup(writes)` since a marker file is meaningless if settings failed to save):

```ts
  await repo.completeSetup(writes);
  const runtimeWrite = writes.find((w) => w.key === "INFERENCE_RUNTIME");
  await writeRuntimeMarker(runtimeWrite?.value ?? "windows");
  return { ok: true };
```

- [ ] **Step 7: Run the full actions test file to verify all 3 tests pass**

Run: `pnpm --filter @netryx/web exec vitest run app/setup/actions.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/runtime-marker.ts apps/web/lib/runtime-marker.test.ts apps/web/app/setup/actions.ts apps/web/app/setup/actions.test.ts
git commit -m "feat(web): write INFERENCE_RUNTIME to a plain marker file when setup completes"
```

---

### Task 2: `tools/service_launcher.py` — pure-ish orchestration helpers for the installer

**Files:**
- Create: `tools/service_launcher.py`

**Interfaces:**
- Consumes: `tools/lumi_paths.py` — nothing directly, but lives alongside it and follows the same "no side effects at import time" convention.
- Produces (Task 3): `read_runtime_marker(root: Path) -> str`, `inference_command(root: Path, runtime: str) -> list[str] | None`, `worker_command(root: Path) -> list[str]`, `wait_for_http_ok(url: str, timeout_s: float) -> bool`, `start_detached(cmd: list[str], cwd: Path) -> subprocess.Popen`, `start_all_services(root: Path, log=print) -> dict[str, subprocess.Popen | None]` — all consumed by `tools/installer_source.py` in Task 3.

- [ ] **Step 1: Write `read_runtime_marker`**

```python
# tools/service_launcher.py
"""
Process-orchestration helpers for tools/installer_source.py: deciding how to
launch the inference service (native venv vs WSL2) and the worker, and
confirming they actually came up. No Python tests here per this project's
standing "no tests under tools/" preference — verify by running
`services/inference/venv/Scripts/python.exe tools/installer_source.py`
(or the compiled exe) and reading its output.
"""
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

INFERENCE_PORT = 8000


def read_runtime_marker(root: Path) -> str:
    """Reads data/runtime-config.json written by apps/web/lib/runtime-marker.ts
    at the end of setup. Defaults to "windows" (INFERENCE_RUNTIME's own schema
    default, packages/shared-types/src/settings.ts) if setup hasn't completed
    yet, or the file is missing/unreadable for any other reason — a fresh
    clone with no marker file should degrade to "try the native venv path",
    not crash."""
    marker_path = root / "data" / "runtime-config.json"
    try:
        data = json.loads(marker_path.read_text(encoding="utf-8"))
        runtime = data.get("inferenceRuntime")
        return runtime if runtime in ("windows", "wsl") else "windows"
    except (OSError, ValueError):
        return "windows"
```

- [ ] **Step 2: Write `inference_command` (both runtimes, with existence checks so a not-yet-installed venv is skipped, not crashed on)**

```python
def _win_path_to_wsl(win_path: Path) -> str:
    # Mirrors apps/web/app/lib/wsl-path.ts's winPathToWsl exactly (same
    # regex-free approach: drive letter lowercased, backslashes to slashes).
    s = str(win_path.resolve())
    drive, rest = s.split(":", 1)
    return f"/mnt/{drive.lower()}{rest.replace(chr(92), '/')}"


def inference_command(root: Path, runtime: str) -> list[str] | None:
    """Returns the argv to launch uvicorn for the chosen runtime, or None if
    that runtime's venv doesn't exist yet (setup hasn't installed it) — the
    caller should skip starting inference rather than launch a command that's
    guaranteed to fail with "file not found"."""
    infer = root / "services" / "inference"
    if runtime == "wsl":
        venv_wsl = infer / "venv-wsl"
        if not venv_wsl.exists():
            return None
        infer_wsl = _win_path_to_wsl(infer)
        script = f"cd '{infer_wsl}' && venv-wsl/bin/uvicorn main:app --host 0.0.0.0 --port {INFERENCE_PORT}"
        return ["wsl.exe", "--", "bash", "-lc", script]
    venv = infer / "venv"
    if not venv.exists():
        return None
    python_exe = venv / "Scripts" / "python.exe"
    return [str(python_exe), "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", str(INFERENCE_PORT)]


def worker_command(root: Path) -> list[str]:
    return ["pnpm", "--filter", "@netryx/worker", "start"]
```

- [ ] **Step 3: Write `wait_for_http_ok` (stdlib-only HTTP poll, mirrors the `/docs` reachability check `apps/web/app/api/setup/prereqs/route.ts:36-42` already uses)**

```python
def wait_for_http_ok(url: str, timeout_s: float, poll_interval_s: float = 1.0) -> bool:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if resp.status < 400:
                    return True
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(poll_interval_s)
    return False
```

- [ ] **Step 4: Write `start_detached` and `start_all_services`**

```python
def start_detached(cmd: list[str], cwd: Path) -> subprocess.Popen:
    # CREATE_NEW_PROCESS_GROUP so closing the installer's own console window
    # doesn't send Ctrl+C/Ctrl+Break to these children too — they're meant to
    # keep running as background services, not die with the installer.
    # NOTE: this only protects the native Windows process (python.exe /
    # pnpm.cmd / wsl.exe itself) from the console signal; if the runtime is
    # "wsl", the actual uvicorn process lives inside the WSL2 VM, which is
    # already independent of any Windows console by construction.
    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
    return subprocess.Popen(
        cmd, cwd=cwd, shell=(sys.platform == "win32" and cmd[0] not in ("wsl.exe",)),
        creationflags=creationflags,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def start_all_services(root: Path, log=print) -> dict[str, "subprocess.Popen | None"]:
    """Starts inference + worker (db is handled separately by
    installer_source.py's existing `docker compose up -d` call, which is
    already correct — see Task 3). Returns a dict of name -> Popen (or None
    if that service was skipped, e.g. inference venv not installed yet)."""
    started: dict[str, "subprocess.Popen | None"] = {}

    runtime = read_runtime_marker(root)
    infer_cmd = inference_command(root, runtime)
    if infer_cmd is None:
        log(f"Servicio de inferencia: entorno '{runtime}' no instalado todavía — omitido "
            f"(completa /setup y vuelve a abrir LumiInstaller.exe).")
        started["inference"] = None
    else:
        log(f"Arrancando servicio de inferencia ({runtime})...")
        started["inference"] = start_detached(infer_cmd, root / "services" / "inference")
        if wait_for_http_ok(f"http://localhost:{INFERENCE_PORT}/docs", timeout_s=45):
            log("Servicio de inferencia: listo.")
        else:
            log("Servicio de inferencia: no respondió a tiempo (puede seguir cargando modelos en segundo plano).")

    log("Arrancando worker...")
    started["worker"] = start_detached(worker_command(root), root)
    time.sleep(3)
    if started["worker"].poll() is None:
        log("Worker: en marcha.")
    else:
        log(f"Worker: terminó inmediatamente (código {started['worker'].returncode}) — revisa que 'pnpm install' se haya completado.")

    return started
```

- [ ] **Step 5: Manually verify (no pytest — see Global Constraints)**

Run:
```powershell
services\inference\venv\Scripts\python.exe -c "
import sys; sys.path.insert(0, 'tools')
from pathlib import Path
from service_launcher import read_runtime_marker, inference_command, worker_command
root = Path('.').resolve()
print('runtime:', read_runtime_marker(root))
print('inference cmd:', inference_command(root, read_runtime_marker(root)))
print('worker cmd:', worker_command(root))
"
```
Expected: prints `runtime: windows` (or `wsl` if `data/runtime-config.json` already exists from a prior setup run on this machine), a real argv list for `inference cmd` if `services/inference/venv` exists, and `['pnpm', '--filter', '@netryx/worker', 'start']` for `worker cmd`. No exceptions.

- [ ] **Step 6: Commit**

```bash
git add tools/service_launcher.py
git commit -m "feat(installer): add service-orchestration helpers (inference + worker launch, health poll)"
```

---

### Task 3: Wire `tools/installer_source.py` to start all four processes

**Files:**
- Modify: `tools/installer_source.py`

**Interfaces:**
- Consumes: `tools/service_launcher.py`'s `start_all_services(root, log)` from Task 2.

- [ ] **Step 1: Add the import and call `start_all_services` between the Postgres step and the final blocking `pnpm dev` call**

```python
# tools/installer_source.py — add near the top, after the existing imports
sys.path.insert(0, str(Path(__file__).resolve().parent))
from service_launcher import start_all_services  # noqa: E402
```

Modify `main()` — insert the new call right after the existing `docker compose up -d --build db` step (so Postgres is confirmed started, matching `services/inference/main.py`'s own `load_model_once()` requiring a DB connection at its own startup — see Task 2's ordering note) and before the final `pnpm --filter @netryx/web dev`:

```python
    if run(["docker", "compose", "up", "-d", "--build", "db"], cwd=root) != 0:
        print("No se pudo arrancar Postgres — ¿está Docker Desktop corriendo?")
        return 1

    print("\nArrancando servicio de inferencia y worker...")
    start_all_services(root, log=print)

    print("\nTodo listo. Arrancando la web en http://localhost:3000 ...")
    print("La primera vez te llevará automáticamente al asistente de instalación (/setup).")
    webbrowser.open("http://localhost:3000")
    return run(["pnpm", "--filter", "@netryx/web", "dev"], cwd=root)
```

(The docstring at the top of the file should also be updated — replace the "What it does" paragraph:)

```python
"""
...
What it does: checks Node.js/pnpm/Python/Docker are on PATH, creates .env
from .env.example if missing, runs `pnpm install`, starts Postgres via
`docker compose`, starts the inference service (native venv or WSL2, per
data/runtime-config.json written by setup — see service_launcher.py) and the
worker, then starts the web app and opens the browser on it. Inference/worker
are skipped with a printed message if their setup step hasn't run yet (fresh
clone, first launch) — the web app still comes up so /setup can run.
...
"""
```

- [ ] **Step 2: Manually verify end-to-end**

Run: `services\inference\venv\Scripts\python.exe tools\installer_source.py` (or `python tools/installer_source.py` if a plain system Python has `docker`/`node`/`pnpm` on PATH — either works per `project_root()`'s existing frozen/dev branching).

Expected console output, in order: pnpm install log tail, docker compose log tail, `Arrancando servicio de inferencia y worker...`, then either `Servicio de inferencia: listo.` (if `services/inference/venv` exists and weights are downloaded) or the "omitido" skip message, then `Worker: en marcha.` (or the "terminó inmediatamente" message if `pnpm install` hasn't been run for `apps/worker` yet), then the browser opens to `localhost:3000`, then the process blocks running `next dev`. Confirm via `Get-Process -Name python,node | Select Id,ProcessName` (PowerShell) that extra `python.exe`/`node.exe` processes exist beyond the foreground `next dev` one.

- [ ] **Step 3: Commit**

```bash
git add tools/installer_source.py
git commit -m "feat(installer): start the inference service and worker alongside Postgres and the web app"
```

---

### Task 4: Setup wizard "verify services" step

**Files:**
- Modify: `apps/web/app/api/setup/run/[step]/route.ts`
- Modify: `apps/web/app/setup/steps/InstallStep.tsx`

**Interfaces:**
- Consumes: `getSettingsRepo().getSetting("INFERENCE_RUNTIME")` (already used elsewhere in this file's neighbors, e.g. `apps/web/app/setup/SetupWizard.tsx`), `winPathToWsl` (`apps/web/app/lib/wsl-path.ts`, already imported in this file).
- Produces: nothing consumed elsewhere — this is the last item in the Install step's list, terminal to that step.

- [ ] **Step 1: Add the special-cased `verify-services` branch to the route**

`useCommandRun` (`apps/web/app/lib/useCommandRun.ts:14`) always POSTs to `/api/setup/run/${step}` — there is no way to point one `InstallItem` at a different URL, so this has to live in the same route file as `STEPS`, handled before the `STEPS[params.step]` lookup (it isn't a fixed-argv one-shot command like the rest of `STEPS`; it starts long-running processes and polls them).

Add near the top of `apps/web/app/api/setup/run/[step]/route.ts`, after the existing `MODELS_CACHE_DIR`/`cacheEnvFor` block and before the `STEPS` object:

```ts
// "verify-services" is not a fixed-argv one-shot command like everything in
// STEPS below — it starts the inference service + worker as DETACHED
// background processes (they must survive after this request's stream
// closes) and polls the inference service's existing /docs reachability
// probe (see apps/web/app/api/setup/prereqs/route.ts) instead of waiting for
// a `close` event that would never come from a long-running server.
// Module-scope so re-running this step (e.g. the wizard's retry button)
// doesn't spawn duplicate processes for the lifetime of this Next.js server.
let verifyServicesStarted: { inference?: import("node:child_process").ChildProcess; worker?: import("node:child_process").ChildProcess } = {};

function inferenceArgvFor(runtime: string): { cmd: string; args: string[]; cwd: string; shell: boolean } | null {
  if (runtime === "wsl") {
    const venvWsl = resolve(INFER, "venv-wsl");
    if (!existsSync(venvWsl)) return null;
    const script = `cd '${INFER_WSL}' && venv-wsl/bin/uvicorn main:app --host 0.0.0.0 --port 8000`;
    return { cmd: "wsl.exe", args: ["--", "bash", "-lc", script], cwd: INFER, shell: false };
  }
  const venv = resolve(INFER, "venv");
  if (!existsSync(venv)) return null;
  return { cmd: resolve(venv, "Scripts", "python.exe"), args: ["-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"], cwd: INFER, shell: false };
}

async function waitForInferenceReady(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("http://localhost:8000/docs", { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // not up yet, keep polling
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function runVerifyServices(send: (e: object) => void): Promise<number> {
  const runtime = (await getSettingsRepo().getSetting("INFERENCE_RUNTIME")) ?? "windows";

  if (!verifyServicesStarted.inference) {
    const argv = inferenceArgvFor(runtime);
    if (!argv) {
      send({ type: "log", line: `Entorno de inferencia (${runtime}) no instalado todavía — completa los pasos anteriores primero.\n` });
      return 1;
    }
    send({ type: "log", line: `Arrancando servicio de inferencia (${runtime})...\n` });
    verifyServicesStarted.inference = spawn(argv.cmd, argv.args, { cwd: argv.cwd, shell: argv.shell, detached: true, stdio: "ignore" });
    verifyServicesStarted.inference.unref();
  } else {
    send({ type: "log", line: "Servicio de inferencia ya estaba en marcha.\n" });
  }

  const ready = await waitForInferenceReady(45000);
  send({ type: "log", line: ready ? "Servicio de inferencia: listo.\n" : "Servicio de inferencia: no respondió a tiempo.\n" });
  if (!ready) return 1;

  if (!verifyServicesStarted.worker) {
    send({ type: "log", line: "Arrancando worker...\n" });
    verifyServicesStarted.worker = spawn("pnpm", ["--filter", "@netryx/worker", "start"], { cwd: REPO_ROOT, shell: true, detached: true, stdio: "ignore" });
    verifyServicesStarted.worker.unref();
    await new Promise((r) => setTimeout(r, 3000));
  }
  // No HTTP surface on the worker (pg-boss consumer, not a server) — "still
  // running 3s after launch" is the closest available signal without adding
  // a heartbeat table. exitCode stays null while a detached child is alive.
  const workerAlive = verifyServicesStarted.worker.exitCode === null;
  send({ type: "log", line: workerAlive ? "Worker: en marcha.\n" : `Worker: terminó (código ${verifyServicesStarted.worker.exitCode}).\n` });
  return workerAlive ? 0 : 1;
}
```

Add the required new import at the top of the file:

```ts
import { existsSync } from "node:fs";
```

Add the branch inside `POST`, before the existing `const step = STEPS[params.step];` line:

```ts
export async function POST(request: Request, { params }: { params: { step: string } }) {
  if (params.step === "verify-services") {
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (e: object) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        const code = await runVerifyServices(send);
        send({ type: "done", code });
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
    });
  }

  const step = STEPS[params.step];
  // ... rest of the existing function body is unchanged
```

- [ ] **Step 2: Add the item to `InstallStep.tsx`'s `ITEMS_BY_RUNTIME`**

```ts
// apps/web/app/setup/steps/InstallStep.tsx
const ITEMS_BY_RUNTIME = {
  windows: [
    { id: "inference-venv", label: "Entorno Python", engine: "venv" },
    { id: "inference-deps", label: "Dependencias PyTorch + CUDA", engine: "pip install" },
    { id: "weights-retrieval", label: "Modelo de recuperación", engine: "Lumi Preview" },
    { id: "weights-verification", label: "Modelo de verificación", engine: "Laila" },
    { id: "verify-services", label: "Arrancar y verificar servicios", engine: "uvicorn + worker" },
  ],
  wsl: [
    { id: "inference-wsl-prereqs", label: "Dependencias del sistema (WSL2)", engine: "apt install" },
    { id: "inference-venv-wsl", label: "Entorno Python (WSL2)", engine: "venv" },
    { id: "inference-deps-wsl", label: "Dependencias PyTorch + CUDA (WSL2)", engine: "pip install" },
    { id: "weights-retrieval-wsl", label: "Modelo de recuperación (WSL2)", engine: "Lumi Preview" },
    { id: "weights-verification-wsl", label: "Modelo de verificación (WSL2)", engine: "Laila" },
    { id: "verify-services", label: "Arrancar y verificar servicios", engine: "uvicorn + worker" },
  ],
} as const;
```

No other change needed in this file — `InstallItem` already runs whatever id it's given through the same `/api/setup/run/${stepId}` endpoint (`apps/web/app/setup/steps/InstallItem.tsx:17`), and `InstallStep`'s existing `onDone`/`activeIdx` sequencing (lines 55-62) already advances past the last item into `onComplete()` regardless of which step id was last.

- [ ] **Step 3: Manually verify (this route has no existing unit test file to extend — `apps/web/app/api/setup/run/[step]/route.test.ts` does not exist today; adding real spawn/SSE integration tests here is out of scope, matching the rest of this file)**

Run the dev server (`pnpm --filter @netryx/web dev`), walk through `/setup` with the Windows runtime already fully installed from a prior session (or after Tasks above have installed it), confirm the new "Arrancar y verificar servicios" row appears last, shows a spinner, then "listo" within ~45s, and that `curl http://localhost:8000/docs` and a running `worker` process (`Get-Process -Name node`) are both present afterward. Then repeat with the WSL2 runtime toggle if a WSL install exists.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/setup/run/[step]/route.ts apps/web/app/setup/steps/InstallStep.tsx
git commit -m "feat(web): add a setup step that starts and health-checks the inference service and worker"
```

---

### Task 5: Update `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the "For people who received a Lumi bundle" section**

Replace:
```markdown
Unzip it, then double-click **`LumiInstaller.exe`** at its root. It checks
you have Node.js + pnpm, Python 3, and Docker Desktop on your PATH, creates
`.env` from `.env.example` if you don't have one yet, runs `pnpm install`,
starts Postgres via `docker compose`, then starts the web app and opens your
browser on it. The first time, you'll land on `/setup` — a step-by-step
wizard that installs the inference service's Python dependencies, downloads
the model weights, sets up the database schema, and collects your Google
Street View API key.
```
with:
```markdown
Unzip it, then double-click **`LumiInstaller.exe`** at its root. It checks
you have Node.js + pnpm, Python 3, and Docker Desktop on your PATH, creates
`.env` from `.env.example` if you don't have one yet, runs `pnpm install`,
starts Postgres via `docker compose`, starts the inference service and the
worker (skipped with a message on a fresh clone — see below), then starts
the web app and opens your browser on it. The first time, you'll land on
`/setup` — a step-by-step wizard that installs the inference service's
Python dependencies, downloads the model weights, sets up the database
schema, collects your Google Street View API key, and finishes by actually
starting the inference service + worker and confirming they're reachable.
Close and reopen `LumiInstaller.exe` after finishing `/setup` for the first
time so it picks up the now-installed inference environment.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: describe the installer's full 4-process startup"
```

---

## Self-Review

**1. Spec coverage:** "arrancar los 3 programas cuando el .exe principal se ejecute" → Tasks 2-3 (db already worked; inference+worker added). "si esta instalado el servicio en wsl habrá que levantarlo desde allí" → Task 2's `inference_command` branches on the marker file. "también la base de datos en docker" → already handled by existing `installer_source.py` code, unchanged. "que en el setup lo intente hacer para comprobar que todo funciona correctamente" → Task 4. Flagged to the user (see final chat response, not this doc): the true process count is 4, not 3 — the worker was missing from the original ask and is included here since indexing jobs silently never process without it.

**2. Placeholder scan:** no TBD/TODO markers; every step has real code or an exact manual-verification command.

**3. Type consistency:** `read_runtime_marker` / marker file shape (`{"inferenceRuntime": string}`) matches between Task 1's TS writer and Task 2's Python reader — same key spelled identically on both sides, called out explicitly in both files' comments. `inferenceArgvFor` (TS, Task 4) and `inference_command` (Python, Task 2) independently reimplement the same venv-selection logic in their own language — this duplication is named directly in the plan's Architecture section, not accidental.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-10-startup-orchestration.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
