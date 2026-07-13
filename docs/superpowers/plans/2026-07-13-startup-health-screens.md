# Startup Health Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the existing but cosmetic-only `BootGate` (`apps/web/app/components/LoadingScreen.tsx`) real health checks for worker and inference, a loading-vs-crashed distinction, and a crash screen showing the actual error — reusing `PlanetBackground`'s existing visual identity for both states.

**Architecture:** A new worker DB heartbeat (worker has no HTTP surface) + the existing inference `/docs` reachability check feed a new `GET /api/health` endpoint that resolves each service to `ready`/`loading`/`crashed` via a pure, elapsed-time-based helper. `tools/build.py` and `lumi_launcher.py`'s existing tagged-logging (`_pump_tagged`) is extended to tee output to `data/logs/{worker,inference}.log`, read back by a new `GET /api/health/logs` endpoint for the crash screen.

**Tech Stack:** Next.js API routes (Node runtime), `pg` (Pool), Vitest, node-pg-migrate, Python (`tools/build.py`, `tools/templates/lumi_launcher.py`), Tailwind + inline CSS animations.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-13-startup-health-screens-design.md` — read it before starting; every task below implements one of its sections.
- Inference loading allowance: 90000ms. Worker loading allowance: 20000ms. Worker heartbeat staleness threshold: 15000ms. These exact values come from the spec.
- No new test framework/library — this repo has no `jsdom`/React Testing Library; component-level UI (Task 9, 10) is verified manually, not with component unit tests, matching the existing convention (only logic/API-route files have `.test.ts` siblings here).
- All new user-facing copy is in Spanish, matching the rest of the app.
- Follow existing file conventions exactly: migrations are node-pg-migrate JS (`exports.up`/`exports.down`, `pgm.sql(...)`); DB pool access via each app's own `getPool()`; API route tests import the route's exported `GET`/`PATCH` and call them directly with a real `Request`, mocking dependencies via `vi.mock`.

---

### Task 1: Worker heartbeat migration

**Files:**
- Create: `db/migrations/1720700000000_worker_heartbeat.js`

**Interfaces:**
- Produces: table `worker_heartbeat(id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1), updated_at timestamptz NOT NULL DEFAULT now())`, a singleton row (only `id = 1` is ever valid).

- [ ] **Step 1: Write the migration**

```js
// db/migrations/1720700000000_worker_heartbeat.js
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE worker_heartbeat (
      id         integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO worker_heartbeat (id) VALUES (1);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE worker_heartbeat;`);
};
```

- [ ] **Step 2: Run the migration against the dev and test databases**

Run: `pnpm db:migrate` (dev DB) and `pnpm --filter @netryx/db migrate:up:test` (test DB, used by Task 2/4's tests)
Expected: both commands print `> migrating worker_heartbeat` (or similar node-pg-migrate output) with no errors.

- [ ] **Step 3: Verify the singleton row exists**

Run: `docker exec netryx-db psql -U netryx -d netryx_dev -c "SELECT * FROM worker_heartbeat;"`
Expected: one row, `id = 1`, `updated_at` set to a recent timestamp.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/1720700000000_worker_heartbeat.js
git commit -m "feat(db): add worker_heartbeat singleton table"
```

---

### Task 2: Worker heartbeat writer

**Files:**
- Create: `apps/worker/src/heartbeat.ts`
- Test: `apps/worker/src/heartbeat.test.ts`

**Interfaces:**
- Consumes: `Pool` from `pg` (via `apps/worker/src/db.ts`'s `getPool()` in the caller, not inside this file — this file takes a `Pool` parameter so it's testable against the real test DB, matching `progress.ts`'s pattern).
- Produces: `touchHeartbeat(pool: Pool): Promise<void>`, `startHeartbeatLoop(pool: Pool, intervalMs?: number): NodeJS.Timeout` — Task 3 imports both.

- [ ] **Step 1: Write the failing test**

```ts
// apps/worker/src/heartbeat.test.ts
import { describe, it, expect, vi, beforeEach, afterAll, afterEach } from "vitest";
import { Pool } from "pg";
import { touchHeartbeat, startHeartbeatLoop } from "./heartbeat";

const connectionString =
  process.env.TEST_DATABASE_URL ?? "postgres://netryx:changeme@localhost:5432/netryx_test";
const pool = new Pool({ connectionString });

beforeEach(async () => {
  await pool.query("UPDATE worker_heartbeat SET updated_at = now() - interval '1 hour' WHERE id = 1");
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await pool.end();
});

describe("touchHeartbeat", () => {
  it("updates the singleton row's updated_at to now", async () => {
    const before = Date.now();
    await touchHeartbeat(pool);
    const { rows } = await pool.query("SELECT updated_at FROM worker_heartbeat WHERE id = 1");
    expect(new Date(rows[0].updated_at).getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("startHeartbeatLoop", () => {
  it("touches the heartbeat immediately, then again every intervalMs", async () => {
    vi.useFakeTimers();
    const touches: number[] = [];
    const fakePool = { query: vi.fn(async () => { touches.push(Date.now()); return { rows: [] }; }) } as unknown as Pool;

    const handle = startHeartbeatLoop(fakePool, 5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(touches.length).toBe(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(touches.length).toBe(2);

    await vi.advanceTimersByTimeAsync(10000);
    expect(touches.length).toBe(4);

    clearInterval(handle);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netryx/worker test heartbeat`
Expected: FAIL — `Cannot find module './heartbeat'`

- [ ] **Step 3: Write the implementation**

```ts
// apps/worker/src/heartbeat.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @netryx/worker test heartbeat`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/heartbeat.ts apps/worker/src/heartbeat.test.ts
git commit -m "feat(worker): add DB heartbeat writer"
```

---

### Task 3: Wire the heartbeat loop into the worker's main()

**Files:**
- Modify: `apps/worker/src/index.ts`

**Interfaces:**
- Consumes: `startHeartbeatLoop` from `./heartbeat` (Task 2).

- [ ] **Step 1: Add the import and start the loop in `main()`**

In `apps/worker/src/index.ts`, add to the top imports:

```ts
import { startHeartbeatLoop } from "./heartbeat";
```

Then inside `async function main()`, right after `const pool = getPool();`, add:

```ts
  startHeartbeatLoop(pool);
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @netryx/worker typecheck`
Expected: no errors.

- [ ] **Step 3: Manual smoke check**

Run: `pnpm --filter @netryx/worker start` for ~10s, then in another terminal:
`docker exec netryx-db psql -U netryx -d netryx_dev -c "SELECT updated_at, now() - updated_at AS age FROM worker_heartbeat;"`
Expected: `age` is a few seconds, not stale. Stop the worker with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat(worker): start heartbeat loop from main()"
```

---

### Task 4: Health-resolution logic (pure + I/O helpers)

**Files:**
- Create: `apps/web/lib/health.ts`
- Test: `apps/web/lib/health.test.ts`

**Interfaces:**
- Consumes: `Pool` from `pg`.
- Produces: `type ServiceStatus = "ready" | "loading" | "crashed"`, `resolveServiceStatus(isHealthyNow, firstUnhealthyAtMs, nowMs, loadingAllowanceMs): ServiceStatus`, `checkInferenceReady(baseUrl: string): Promise<boolean>`, `checkWorkerHeartbeatFresh(pool: Pool, staleAfterMs: number): Promise<boolean>` — Task 5's route imports all four.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/health.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { Pool } from "pg";
import { resolveServiceStatus, checkInferenceReady, checkWorkerHeartbeatFresh } from "./health";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveServiceStatus", () => {
  it("is ready when healthy right now, regardless of history", () => {
    expect(resolveServiceStatus(true, 1000, 2000, 500)).toBe("ready");
    expect(resolveServiceStatus(true, null, 2000, 500)).toBe("ready");
  });

  it("is loading when unhealthy but within the allowance, or with no start time yet", () => {
    expect(resolveServiceStatus(false, null, 2000, 90000)).toBe("loading");
    expect(resolveServiceStatus(false, 1000, 1500, 90000)).toBe("loading");
  });

  it("is crashed once unhealthy beyond the allowance", () => {
    expect(resolveServiceStatus(false, 1000, 92000, 90000)).toBe("crashed");
  });
});

describe("checkInferenceReady", () => {
  it("is true when /docs responds ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    expect(await checkInferenceReady("http://localhost:8000")).toBe(true);
  });

  it("is false when /docs responds non-ok or the fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await checkInferenceReady("http://localhost:8000")).toBe(false);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    expect(await checkInferenceReady("http://localhost:8000")).toBe(false);
  });
});

describe("checkWorkerHeartbeatFresh", () => {
  const connectionString =
    process.env.TEST_DATABASE_URL ?? "postgres://netryx:changeme@localhost:5432/netryx_test";
  const pool = new Pool({ connectionString });

  it("is true when the heartbeat was touched recently", async () => {
    await pool.query("UPDATE worker_heartbeat SET updated_at = now() WHERE id = 1");
    expect(await checkWorkerHeartbeatFresh(pool, 15000)).toBe(true);
  });

  it("is false when the heartbeat is older than staleAfterMs", async () => {
    await pool.query("UPDATE worker_heartbeat SET updated_at = now() - interval '1 hour' WHERE id = 1");
    expect(await checkWorkerHeartbeatFresh(pool, 15000)).toBe(false);
    await pool.end();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test health`
Expected: FAIL — `Cannot find module './health'`

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/lib/health.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test health`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/health.ts apps/web/lib/health.test.ts
git commit -m "feat(web): add health-resolution logic for inference/worker"
```

---

### Task 5: `GET /api/health` endpoint

**Files:**
- Create: `apps/web/app/api/health/route.ts`
- Test: `apps/web/app/api/health/route.test.ts`

**Interfaces:**
- Consumes: `resolveServiceStatus`, `checkInferenceReady`, `checkWorkerHeartbeatFresh` from `../../../lib/health` (Task 4); `getPool` from `../../../lib/db`.
- Produces: `GET(): Promise<Response>` returning `{ web: "ready", worker: ServiceStatus, inference: ServiceStatus }` — Task 10's `BootGate` polls this.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/api/health/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/health", () => ({
  checkInferenceReady: vi.fn(),
  checkWorkerHeartbeatFresh: vi.fn(),
  resolveServiceStatus: vi.fn((isHealthyNow: boolean) => (isHealthyNow ? "ready" : "loading")),
}));
vi.mock("../../../lib/db", () => ({ getPool: vi.fn(() => ({})) }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/health", () => {
  it("reports web as always ready, and worker/inference from the health checks", async () => {
    const health = await import("../../../lib/health");
    (health.checkInferenceReady as any).mockResolvedValue(true);
    (health.checkWorkerHeartbeatFresh as any).mockResolvedValue(false);

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(json.web).toBe("ready");
    expect(json.inference).toBe("ready");
    expect(json.worker).toBe("loading");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netryx/web test app/api/health/route`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/api/health/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../lib/db";
import { checkInferenceReady, checkWorkerHeartbeatFresh, resolveServiceStatus } from "../../../lib/health";

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @netryx/web test app/api/health/route`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/health/route.ts apps/web/app/api/health/route.test.ts
git commit -m "feat(web): add GET /api/health"
```

---

### Task 6: Tee tagged subprocess output to log files (`tools/build.py`)

**Files:**
- Modify: `tools/build.py`

**Interfaces:**
- Produces: `data/logs/worker.log`, `data/logs/inference.log` (created/appended whenever `dev()` runs), read by Task 8's `GET /api/health/logs`.

- [ ] **Step 1: Add a log-file path helper and open handles in `_pump_tagged`**

In `tools/build.py`, near the top (after the `_PRINT_LOCK` definition added earlier today), add:

```python
# tools/build.py — near _PRINT_LOCK
REPO_ROOT_FOR_LOGS = Path(__file__).resolve().parent.parent
TEE_TO_FILE_TAGS = {"worker", "inference"}


def _log_file_path(tag: str) -> Path:
    log_dir = REPO_ROOT_FOR_LOGS / "data" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir / f"{tag}.log"
```

Then change `_pump_tagged` from:

```python
def _pump_tagged(proc: subprocess.Popen, tag: str) -> None:
    """Reprints proc's merged stdout/stderr line-by-line prefixed with
    f"[{tag}]" until it exits. Assumes proc was opened with
    stdout=PIPE, stderr=STDOUT, text=True."""
    assert proc.stdout is not None
    for line in proc.stdout:
        with _PRINT_LOCK:
            print(f"[{tag}] {line.rstrip(chr(10))}")
    proc.stdout.close()
```

to:

```python
def _pump_tagged(proc: subprocess.Popen, tag: str) -> None:
    """Reprints proc's merged stdout/stderr line-by-line prefixed with
    f"[{tag}]" until it exits. Assumes proc was opened with
    stdout=PIPE, stderr=STDOUT, text=True. For tags in TEE_TO_FILE_TAGS,
    also appends each line to data/logs/{tag}.log — apps/web's
    GET /api/health/logs tails this for the crash screen, since worker/
    inference are separate OS processes the web app can't otherwise read
    output from."""
    assert proc.stdout is not None
    log_file = _log_file_path(tag).open("a", encoding="utf-8") if tag in TEE_TO_FILE_TAGS else None
    try:
        for line in proc.stdout:
            stripped = line.rstrip(chr(10))
            with _PRINT_LOCK:
                print(f"[{tag}] {stripped}")
            if log_file is not None:
                log_file.write(stripped + "\n")
                log_file.flush()
    finally:
        if log_file is not None:
            log_file.close()
    proc.stdout.close()
```

- [ ] **Step 2: Typecheck / syntax check**

Run: `python3 -m py_compile tools/build.py`
Expected: no output, exit code 0.

- [ ] **Step 3: Manual smoke check**

Run: `python3 tools/build.py` for ~15s (Ctrl+C to stop), then:
`tail -5 data/logs/worker.log` and `tail -5 data/logs/inference.log` (or the "no existe todavía" message if inference has no venv)
Expected: files exist with the same tagged lines seen in the terminal (minus the `[tag]` prefix, since the file only gets the raw line).

- [ ] **Step 4: Add `data/logs/` to `.gitignore` if not already covered**

Run: `grep -n '^data/' .gitignore || echo "not covered"`
If `data/` (the whole directory) is already gitignored, no change needed. Otherwise add a `data/logs/` line to `.gitignore`.

- [ ] **Step 5: Commit**

```bash
git add tools/build.py .gitignore
git commit -m "feat(dev): tee worker/inference output to data/logs/*.log"
```

---

### Task 7: Tee tagged subprocess output to log files (`lumi_launcher.py`)

**Files:**
- Modify: `tools/templates/lumi_launcher.py`

**Interfaces:**
- Produces: same `data/logs/{worker,inference}.log` files as Task 6, for the packaged-binary code path.

- [ ] **Step 1: Add the same log-file teeing to `_pump_tagged`**

In `tools/templates/lumi_launcher.py`, add near the top (after `_PRINT_LOCK`):

```python
TEE_TO_FILE_TAGS = {"worker", "inference"}


def _log_file_path(tag: str, root: Path) -> Path:
    log_dir = root / "data" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir / f"{tag}.log"
```

Then change `_pump_tagged` (which currently takes `(proc, tag)`) to also accept `root`, and tee to file:

```python
def _pump_tagged(proc: subprocess.Popen, tag: str, root: Path) -> None:
    """Reprints proc's merged stdout/stderr line-by-line, prefixed with
    f"[{tag}]", so a terminal running the packaged binary can tell which
    of docker/inference/worker/web a line came from instead of one
    unlabeled stream. For tags in TEE_TO_FILE_TAGS, also appends each line
    to data/logs/{tag}.log for the web app's crash screen to read."""
    assert proc.stdout is not None
    log_file = _log_file_path(tag, root).open("a", encoding="utf-8") if tag in TEE_TO_FILE_TAGS else None
    try:
        for line in proc.stdout:
            stripped = line.rstrip(chr(10))
            with _PRINT_LOCK:
                print(f"[{tag}] {stripped}")
            if log_file is not None:
                log_file.write(stripped + "\n")
                log_file.flush()
    finally:
        if log_file is not None:
            log_file.close()
```

- [ ] **Step 2: Update the three call sites to pass `root`**

`start_detached` and `run_foreground` both call `_pump_tagged` — update their signatures/calls to thread `root` through. `start_detached(cmd, cwd, tag, env=None)` becomes `start_detached(cmd, cwd, tag, root, env=None)`, and its internal `threading.Thread(target=_pump_tagged, args=(proc, tag), daemon=True).start()` becomes `args=(proc, tag, root)`. `run_foreground(cmd, cwd, tag, env=None)` becomes `run_foreground(cmd, cwd, tag, root, env=None)`, with its `_pump_tagged(proc, tag)` call becoming `_pump_tagged(proc, tag, root)`.

Update the 4 call sites in `main()` to pass `root` (already in scope there): `run_foreground(["docker", "compose", "up", "-d", "--build", "db"], cwd=root, tag="docker", root=root)`, `start_detached(infer_cmd, root / "services" / "inference", "inference", root)`, `start_detached(["node", str(worker_js)], root, "worker", root, env=node_env)`, `run_foreground(["node", "server.js"], cwd=web_dir, tag="web", root=root, env=node_env)`.

- [ ] **Step 3: Syntax check**

Run: `python3 -m py_compile tools/templates/lumi_launcher.py`
Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add tools/templates/lumi_launcher.py
git commit -m "feat(launcher): tee worker/inference output to data/logs/*.log"
```

---

### Task 8: `GET /api/health/logs` endpoint

**Files:**
- Create: `apps/web/app/api/health/logs/route.ts`
- Test: `apps/web/app/api/health/logs/route.test.ts`

**Interfaces:**
- Produces: `GET(request: Request): Promise<Response>` returning `{ lines: string[] }` (last 50 lines) or `400` for an unrecognized `service` query param — Task 10's crash screen fetches this.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/api/health/logs/route.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { GET } from "./route";

const REPO_ROOT = resolve(process.cwd(), "..", "..");
const LOG_DIR = resolve(REPO_ROOT, "data", "logs");

beforeAll(async () => {
  await mkdir(LOG_DIR, { recursive: true });
  const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
  await writeFile(resolve(LOG_DIR, "inference.log"), lines + "\n");
});

afterAll(async () => {
  await rm(resolve(LOG_DIR, "inference.log"), { force: true });
});

function makeRequest(service: string | null) {
  const url = service ? `http://localhost/api/health/logs?service=${service}` : "http://localhost/api/health/logs";
  return new Request(url);
}

describe("GET /api/health/logs", () => {
  it("returns only the last 50 lines of the requested service's log", async () => {
    const res = await GET(makeRequest("inference"));
    const json = await res.json();
    expect(json.lines).toHaveLength(50);
    expect(json.lines[0]).toBe("line 10");
    expect(json.lines[49]).toBe("line 59");
  });

  it("rejects an unrecognized service", async () => {
    const res = await GET(makeRequest("web"));
    expect(res.status).toBe(400);
  });

  it("returns an empty list when the log file doesn't exist yet", async () => {
    const res = await GET(makeRequest("worker"));
    const json = await res.json();
    expect(json.lines).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netryx/web test app/api/health/logs/route`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/api/health/logs/route.ts
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const REPO_ROOT = resolve(process.cwd(), "..", "..");
const ALLOWED_SERVICES = new Set(["worker", "inference"]);
const MAX_LINES = 50;

export async function GET(request: Request) {
  const service = new URL(request.url).searchParams.get("service");
  if (!service || !ALLOWED_SERVICES.has(service)) {
    return NextResponse.json({ error: "unknown service" }, { status: 400 });
  }

  const logPath = resolve(REPO_ROOT, "data", "logs", `${service}.log`);
  try {
    const content = await readFile(logPath, "utf8");
    const lines = content.split("\n").filter((line) => line.length > 0);
    return NextResponse.json({ lines: lines.slice(-MAX_LINES) });
  } catch {
    return NextResponse.json({ lines: [] });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @netryx/web test app/api/health/logs/route`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/health/logs/route.ts apps/web/app/api/health/logs/route.test.ts
git commit -m "feat(web): add GET /api/health/logs"
```

---

### Task 9: Crash-state animation in `PlanetBackground`

**Files:**
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/app/components/PlanetBackground.tsx`

**Interfaces:**
- Produces: `PlanetBackground({ satellite, dead }: { satellite?: boolean; dead?: boolean })` — Task 10 renders `<PlanetBackground dead />` for the crash screen.

- [ ] **Step 1: Add the new keyframes to `globals.css`**

Add these two lines next to the existing `lumi-*` keyframes (after `@keyframes lumi-spin`):

```css
@keyframes lumi-tumble-fall {
  0%   { transform: rotate(224deg) translateY(-260px) rotate(-224deg); opacity: 1; }
  10%  { transform: rotate(224deg) translateY(-260px) rotate(-224deg); opacity: 1; }
  78%  { transform: rotate(224deg) translateY(-260px) translate(-96px, 150px); opacity: .5; }
  100% { transform: rotate(224deg) translateY(-260px) translate(-150px, 250px); opacity: 0; }
}
```

- [ ] **Step 2: Add the `dead` variant to `PlanetBackground.tsx`**

Replace the full file with:

```tsx
// apps/web/app/components/PlanetBackground.tsx
"use client";
const STARS = [
  { t: "8%", l: "12%", d: "0s" }, { t: "16%", l: "76%", d: ".6s" }, { t: "26%", l: "40%", d: "1.2s" },
  { t: "12%", l: "58%", d: "1.8s" }, { t: "70%", l: "8%", d: ".4s" }, { t: "82%", l: "30%", d: "2.1s" },
  { t: "60%", l: "88%", d: "1.5s" }, { t: "40%", l: "92%", d: ".9s" },
];
const PLANET_TEX =
  "radial-gradient(70px 46px at 8% 32%,rgba(255,255,255,.06),transparent 70%)," +
  "radial-gradient(90px 56px at 26% 64%,rgba(0,0,0,.28),transparent 70%)," +
  "radial-gradient(56px 44px at 44% 40%,rgba(255,255,255,.05),transparent 70%)," +
  "radial-gradient(100px 66px at 62% 72%,rgba(0,0,0,.24),transparent 70%)," +
  "radial-gradient(70px 46px at 58% 32%,rgba(255,255,255,.06),transparent 70%),#3a3f47";

export function PlanetBackground({ satellite = false, dead = false }: { satellite?: boolean; dead?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-[#05070a]">
      {STARS.map((s, i) => (
        <span key={i} className="lumi-anim absolute h-0.5 w-0.5 rounded-full bg-white"
          style={{ top: s.t, left: s.l, animation: `lumi-twinkle ${dead ? 5 : 3}s ease-in-out ${s.d} infinite`, opacity: dead ? 0.5 : undefined }} />
      ))}
      <div className="absolute -right-40 -bottom-52 h-[520px] w-[520px] overflow-hidden rounded-full"
        style={{ background: "#33383f", boxShadow: "0 0 130px 24px rgba(150,160,175,.10), inset -34px -22px 90px rgba(0,0,0,.65)", filter: dead ? "saturate(0.55) brightness(0.75)" : undefined }}>
        <div className="lumi-anim absolute left-0 top-0 h-full w-[200%]"
          style={{ animation: `lumi-planet-spin ${dead ? 220 : 70}s linear infinite`, background: PLANET_TEX }} />
        <div className="absolute inset-0 rounded-full"
          style={{ background: "radial-gradient(circle at 30% 28%,transparent 42%,rgba(0,0,0,.55) 100%)" }} />
      </div>
      {satellite && !dead && (
        <div className="lumi-anim absolute -bottom-32 left-1/2 -ml-[260px] h-[520px] w-[520px]"
          style={{ animation: "lumi-orbit 14s linear infinite" }}>
          <div className="absolute -top-1 left-1/2 -ml-[3px] h-[7px] w-[7px] rounded-full bg-[#f4f6f9]"
            style={{ boxShadow: "0 0 10px 2px rgba(255,255,255,.6)" }} />
        </div>
      )}
      {dead && (
        <>
          <div className="absolute -bottom-32 left-1/2 -ml-[260px] h-[520px] w-[520px] rounded-full"
            style={{ border: "1px dashed rgba(239,159,39,0.22)", clipPath: "polygon(0 0, 100% 0, 100% 62%, 0 62%)" }} />
          {[
            { size: 8, color: "var(--danger-fg, #e88f8f)", glow: true, delay: "0s" },
            { size: 6, color: "rgba(239,159,39,0.55)", glow: false, delay: "-0.22s" },
            { size: 4, color: "rgba(239,159,39,0.3)", glow: false, delay: "-0.4s" },
          ].map((dot, i) => (
            <div key={i} className="lumi-anim absolute -bottom-32 left-1/2"
              style={{
                marginLeft: -dot.size / 2, top: -4, height: dot.size, width: dot.size, borderRadius: "50%",
                background: dot.color,
                boxShadow: dot.glow ? "0 0 9px 2px rgba(239,159,39,0.4)" : "none",
                animation: `lumi-tumble-fall 4.2s cubic-bezier(.55,0,.75,1) ${dot.delay} infinite`,
              }} />
          ))}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/globals.css apps/web/app/components/PlanetBackground.tsx
git commit -m "feat(web): add crash-state (broken orbit) variant to PlanetBackground"
```

---

### Task 10: Real `BootGate` — polling, preflight chips, crash screen

**Files:**
- Modify: `apps/web/app/components/LoadingScreen.tsx`

**Interfaces:**
- Consumes: `PlanetBackground` (Task 9), `GET /api/health` (Task 5), `GET /api/health/logs?service=` (Task 8).
- Produces: `BootGate({ children })` unchanged signature — `(protected)/layout.tsx` needs no changes.

- [ ] **Step 1: Replace the file**

```tsx
// apps/web/app/components/LoadingScreen.tsx
"use client";
import { useEffect, useState } from "react";
import { PlanetBackground } from "./PlanetBackground";

type ServiceStatus = "ready" | "loading" | "crashed";
interface HealthResponse { web: ServiceStatus; worker: ServiceStatus; inference: ServiceStatus }

const SERVICES: { key: keyof HealthResponse; label: string; icon: JSX.Element }[] = [
  {
    key: "web", label: "Web",
    icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8.5h18"/><circle cx="6" cy="6.25" r=".4" fill="currentColor" stroke="none"/></svg>,
  },
  {
    key: "worker", label: "Worker",
    icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 8 4.5-8 4.5-8-4.5Z"/><path d="m4 12 8 4.5 8-4.5"/><path d="m4 16.5 8 4.5 8-4.5"/></svg>,
  },
  {
    key: "inference", label: "Inferencia",
    icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v5.5"/><path d="m19.8 8-4.8 2.7"/><path d="m19.8 16-4.8-2.7"/><path d="M12 21v-5.5"/><path d="m4.2 16 4.8-2.7"/><path d="m4.2 8 4.8 2.7"/></svg>,
  },
];

function PreflightChip({ label, icon, status }: { label: string; icon: JSX.Element; status: ServiceStatus }) {
  const ringClass = status === "ready" ? "ready" : status === "crashed" ? "failed" : "pending";
  return (
    <div className="flex w-24 flex-col items-center gap-2">
      <div className={`relative flex h-[42px] w-[42px] items-center justify-center rounded-full ${
        ringClass === "pending" ? "animate-pulse border border-dashed border-white/25" :
        ringClass === "ready" ? "border border-[rgba(127,214,143,0.45)] bg-[rgba(127,214,143,0.07)]" :
        "border border-[rgba(239,159,39,0.5)] bg-[rgba(239,159,39,0.08)]"
      }`}>
        <span className={ringClass === "ready" ? "text-[#cdeed3]" : ringClass === "failed" ? "text-warning-fg" : "text-subtle"}>{icon}</span>
        {status !== "loading" && (
          <span className={`absolute -bottom-[3px] -right-[3px] h-4 w-4 rounded-full border-2 border-bg ${status === "ready" ? "bg-[#7fd68f]" : "bg-warning-fg"}`} />
        )}
      </div>
      <span className="text-[11.5px] font-medium text-fg">{label}</span>
      <span className="text-[10.5px] text-subtle">
        {status === "ready" ? "listo" : status === "crashed" ? "detenido" : "cargando…"}
      </span>
    </div>
  );
}

function LoadingScene({ health }: { health: HealthResponse }) {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden">
      <PlanetBackground satellite />
      <div className="relative text-center">
        <div className="text-5xl font-medium tracking-[6px] text-fg">Lumi</div>
        <p className="mt-2 text-sm text-muted">Preparando tu espacio de trabajo…</p>
        <div className="relative mx-auto mt-5 h-[3px] w-56 overflow-hidden rounded-full bg-white/10">
          <div className="lumi-anim absolute left-0 top-0 h-full w-2/5 rounded-full"
            style={{ background: "linear-gradient(90deg,transparent,#f4f6f9,transparent)", animation: "lumi-shimmer 1.6s ease-in-out infinite" }} />
        </div>
        <div className="mt-7 flex items-start justify-center gap-1">
          {SERVICES.map((s) => <PreflightChip key={s.key} label={s.label} icon={s.icon} status={health[s.key]} />)}
        </div>
      </div>
    </div>
  );
}

function CrashScene({ health }: { health: HealthResponse }) {
  const crashedService = SERVICES.find((s) => health[s.key] === "crashed");
  const [logLines, setLogLines] = useState<string[]>([]);

  useEffect(() => {
    if (!crashedService || crashedService.key === "web") return;
    fetch(`/api/health/logs?service=${crashedService.key}`)
      .then((r) => r.json())
      .then((data) => setLogLines(data.lines ?? []))
      .catch(() => {});
  }, [crashedService]);

  const serviceLabel = crashedService?.label ?? "un servicio";

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden px-6 text-center">
      <PlanetBackground dead />
      <svg className="mb-2 text-warning-fg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9.3" y="9.3" width="5.4" height="5.4" rx="1.1" />
        <path d="M9.3 10.6 4.5 8.2" /><path d="M9.3 13.4 4.5 15.8" />
        <path d="M14.7 10.6 19.5 8.2" strokeDasharray="1 2.6" /><path d="M14.7 13.4 19.5 15.8" />
      </svg>
      <div className="text-[21px] font-semibold text-fg">El servicio de {serviceLabel.toLowerCase()} dejó de responder</div>
      <p className="mt-1.5 max-w-[50ch] text-[13.5px] text-muted">
        Lumi no puede continuar sin él. Esto es lo último que escribió antes de detenerse:
      </p>

      <div className="mt-5 flex items-start justify-center gap-1">
        {SERVICES.map((s) => <PreflightChip key={s.key} label={s.label} icon={s.icon} status={health[s.key]} />)}
      </div>

      {crashedService && crashedService.key !== "web" && (
        <div className="mt-5 w-[min(560px,88vw)] overflow-hidden rounded-xl border border-[rgba(239,159,39,0.3)] bg-elevated/90 text-left shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2.5">
            <span className="text-xs font-medium text-fg">data/logs/{crashedService.key}.log</span>
            <span className="rounded-full bg-[rgba(239,159,39,0.15)] px-2.5 py-0.5 text-[10.5px] font-medium text-warning-fg">proceso detenido</span>
          </div>
          <pre className="max-h-[190px] overflow-y-auto whitespace-pre-wrap break-words p-3.5 font-mono text-[11px] leading-relaxed text-muted">
            {logLines.length > 0 ? logLines.join("\n") : "(sin líneas de log todavía)"}
          </pre>
        </div>
      )}

      <div className="mt-4 flex gap-2.5">
        <button onClick={() => window.location.reload()} className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-black">Reintentar</button>
        <a href="/settings" className="flex items-center rounded-lg border border-white/15 px-4 py-2 text-xs text-fg hover:bg-white/10">Ver ajustes</a>
      </div>
    </div>
  );
}

export function BootGate({ children }: { children: React.ReactNode }) {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/health");
        const data: HealthResponse = await res.json();
        if (!cancelled) setHealth(data);
      } catch {
        // Network hiccup polling /api/health itself — keep the previous
        // state (or null/loading) rather than flashing a crash screen.
      }
    }
    poll();
    const interval = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (!health || health.worker !== "ready" || health.inference !== "ready") {
    const anyCrashed = health && (health.worker === "crashed" || health.inference === "crashed");
    return anyCrashed ? <CrashScene health={health} /> : <LoadingScene health={health ?? { web: "ready", worker: "loading", inference: "loading" }} />;
  }
  return <>{children}</>;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Start the full dev stack (`python3 tools/build.py`), open `localhost:3000` immediately — confirm the preflight chips show `worker`/`inferencia` as "cargando…" until they flip to "listo". Then kill the inference process (`pkill -f "uvicorn main:app"`) while the app is open and wait ~90s — confirm the crash screen appears with the tailed log content, the correct service label, and that "Reintentar" reloads the page. Restart inference and confirm the app recovers on its own without a manual reload once `/api/health` reports it ready again.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/LoadingScreen.tsx
git commit -m "feat(web): give BootGate real health checks and a crash screen"
```

---

## Self-Review Notes

- **Spec coverage**: worker heartbeat (Task 1-3), inference `/docs` reuse + loading/crashed heuristic (Task 4-5), log-file teeing in both supervisors (Task 6-7), log-tail endpoint (Task 8), reused `PlanetBackground` for both states + preflight chips + crash screen with real log + actions (Task 9-10). All spec sections covered.
- **Placeholder scan**: none — every step has runnable code and exact commands.
- **Type consistency**: `ServiceStatus` (`"ready" | "loading" | "crashed"`) is defined once in `lib/health.ts` (Task 4) and reused verbatim (as a locally-duplicated type, since `LoadingScreen.tsx` is a client component and can't import server-only `lib/health.ts`) in Task 10 — same three string values throughout. `resolveServiceStatus`'s parameter order and `startHeartbeatLoop`'s signature are used identically wherever referenced.
