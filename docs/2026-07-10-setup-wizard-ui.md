# Setup Wizard UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn first-run setup into a guided, step-by-step wizard that checks prerequisites, runs DB migrations, tests + stores credentials, and installs the Python inference dependencies + model weights — each long-running step streaming live logs into a translucent console — ending by marking setup complete and landing on the app.

**Architecture:** A client wizard at `/setup` drives a pure step state machine. Read-only checks (`GET /api/setup/prereqs`) and a credential test (`POST /api/setup/test-key`) are ordinary routes. The long steps run through **one command-runner** (`POST /api/setup/run/[step]`) that `spawn`s a fixed, per-step argv command and streams stdout/stderr as SSE; the client reads that stream with a `fetch`+`ReadableStream` reader (not `EventSource`, which can't POST) via a `useCommandRun` hook, parsing each line with a pure `parseRunEvent`. The runner is a hard security boundary: fixed commands (never built from request input), gated to pre-setup unless `?rerun=1`, justified only by the self-hosted trusted-network / no-auth model (spec §7.1, §10.3).

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind (existing theme), Node `child_process`, vitest.

**Depends on:** Foundation (`/setup`, `submitSetup`, `system_settings`, `__setup_completed__`, the `(protected)` gate), Dashboard & Map UI Part 1 (Tailwind theme, `FloatingCard`), the settings/free-tier work, and the DB/inference stacks (migrations in `db/`, `services/inference` venv + `requirements.txt`, MegaLoc/RoMa loaders). **Supersedes Tasks 13–14 of `2026-07-09-ui-refinement-onboarding-cost.md`** (and fixes the wrong relative import paths that plan's terser version introduced).

**Out of scope:** cross-platform command sets (targets the documented Windows-native setup, spec §7.1); auth on the runner (trusted-network assumption); a general job/task system (the runner is setup-only); rolling back a partially-completed step.

## Global Constraints

- **Command runner is a security boundary.** Commands are declared as fixed argv arrays keyed by step id — never interpolated from request input. The runner refuses to execute once `__setup_completed__` is `true`, unless the request carries `?rerun=1` (so `/settings` can later offer "reinstalar dependencias"). A comment at the top of the runner module states the trusted-network / no-auth assumption (spec §10.3).
- **Windows-native (spec §7.1):** `spawn(..., { shell: true })` so `pnpm`/`python` resolve via the shell (`pnpm` is `pnpm.cmd` on Windows); venv executables referenced by absolute path (`services/inference/venv/Scripts/{python,pip}.exe`). The repo path has no spaces; documented.
- **Correct relative paths:** from `app/api/setup/prereqs/route.ts` the web `lib` is `../../../../lib`; from `app/api/setup/run/[step]/route.ts` it is `../../../../../lib`. (The superseded terser plan used too few `../` — do not copy those.)
- **Reuse the design system:** `FloatingCard` (translucent + blur), Tailwind tokens; the log console is a translucent `<pre>`.
- **Route-export rule** for `route.ts`/`page.tsx`. **No path aliases.**
- TDD for pure logic (step machine, log parsing); endpoints + wizard UI (child processes, SSE, forms) verified manually. Frequent commits.

---

## File Structure

```
apps/web/app/
├── setup/
│   ├── page.tsx                         # Modify — render <SetupWizard/>
│   ├── wizard-steps.ts                  # Task 1 (pure state machine)
│   ├── wizard-steps.test.ts             # Task 1
│   ├── SetupWizard.tsx                  # Task 4 (shell)
│   └── steps/
│       ├── PrereqsStep.tsx              # Task 4
│       ├── MigrateStep.tsx              # Task 4
│       ├── CredentialsStep.tsx          # Task 4
│       ├── InferenceStep.tsx            # Task 4
│       └── ConfirmStep.tsx              # Task 4
├── lib/
│   ├── run-log.ts                       # Task 1 (pure SSE-line parse)
│   ├── run-log.test.ts                  # Task 1
│   └── useCommandRun.ts                 # Task 3 (SSE reader hook)
├── components/
│   └── RunConsole.tsx                   # Task 3 (translucent log console)
└── api/setup/
    ├── prereqs/route.ts                 # Task 2
    ├── test-key/route.ts                # Task 2
    └── run/[step]/route.ts              # Task 2
```

---

### Task 1: Pure step machine + log parser

**Files:** Create `apps/web/app/setup/wizard-steps.ts`, `wizard-steps.test.ts`, `apps/web/app/lib/run-log.ts`, `run-log.test.ts`.

**Interfaces:**
- Produces: `WIZARD_STEPS`, `StepId`, `nextStep(id)`, `prevStep(id)`, `isComplete(id)`; `RunEvent`, `parseRunEvent(data): RunEvent`.

- [ ] **Step 1: Failing tests**

```typescript
// apps/web/app/setup/wizard-steps.test.ts
import { describe, it, expect } from "vitest";
import { WIZARD_STEPS, nextStep, prevStep, isComplete } from "./wizard-steps";

describe("wizard steps", () => {
  it("orders the five steps and walks forward/back", () => {
    expect(WIZARD_STEPS.map((s) => s.id)).toEqual(["prereqs", "migrate", "credentials", "inference", "confirm"]);
    expect(nextStep("prereqs")).toBe("migrate");
    expect(prevStep("credentials")).toBe("migrate");
    expect(nextStep("confirm")).toBeNull();
    expect(prevStep("prereqs")).toBeNull();
    expect(isComplete("confirm")).toBe(true);
  });
});
```

```typescript
// apps/web/app/lib/run-log.test.ts
import { describe, it, expect } from "vitest";
import { parseRunEvent } from "./run-log";
it("parses log and done events", () => {
  expect(parseRunEvent('{"type":"log","line":"Collecting torch"}')).toEqual({ type: "log", line: "Collecting torch" });
  expect(parseRunEvent('{"type":"done","code":0}')).toEqual({ type: "done", code: 0 });
});
it("returns null for a blank or malformed line", () => {
  expect(parseRunEvent("")).toBeNull();
  expect(parseRunEvent("not json")).toBeNull();
});
```

- [ ] **Step 2: Run → FAIL; implement**

```typescript
// apps/web/app/setup/wizard-steps.ts
export const WIZARD_STEPS = [
  { id: "prereqs", title: "Prerequisitos" },
  { id: "migrate", title: "Base de datos" },
  { id: "credentials", title: "Credenciales" },
  { id: "inference", title: "Dependencias de inferencia" },
  { id: "confirm", title: "Confirmación" },
] as const;
export type StepId = (typeof WIZARD_STEPS)[number]["id"];
const idx = (id: StepId) => WIZARD_STEPS.findIndex((s) => s.id === id);
export function nextStep(id: StepId): StepId | null {
  const i = idx(id);
  return i >= 0 && i < WIZARD_STEPS.length - 1 ? WIZARD_STEPS[i + 1].id : null;
}
export function prevStep(id: StepId): StepId | null {
  const i = idx(id);
  return i > 0 ? WIZARD_STEPS[i - 1].id : null;
}
export function isComplete(id: StepId): boolean { return id === "confirm"; }
```

```typescript
// apps/web/app/lib/run-log.ts
export type RunEvent = { type: "log"; line: string } | { type: "done"; code: number };
export function parseRunEvent(data: string): RunEvent | null {
  if (!data.trim()) return null;
  try {
    const e = JSON.parse(data);
    if (e?.type === "log" || e?.type === "done") return e as RunEvent;
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Run → PASS; commit**

```bash
git add apps/web/app/setup/wizard-steps.ts apps/web/app/setup/wizard-steps.test.ts apps/web/app/lib/run-log.ts apps/web/app/lib/run-log.test.ts
git commit -m "feat(setup): pure wizard step machine + run-log parser"
```

---

### Task 2: Endpoints — prereqs, credential test, command runner

**Files:** Create `apps/web/app/api/setup/prereqs/route.ts`, `test-key/route.ts`, `run/[step]/route.ts`.

- [ ] **Step 1: Prereq checks** (read-only)

```typescript
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
```

- [ ] **Step 2: Credential test** — minimal real Street View metadata call (the metadata endpoint is free, so this costs nothing).

```typescript
// apps/web/app/api/setup/test-key/route.ts
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { key } = (await request.json()) as { key?: string };
  if (!key) return NextResponse.json({ ok: false, error: "falta la API key" }, { status: 400 });
  // Street View metadata is a free endpoint; a well-formed key returns status OK/ZERO_RESULTS,
  // a bad key returns REQUEST_DENIED.
  const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=40.714,-73.998&key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url);
    const body = (await res.json()) as { status?: string; error_message?: string };
    const ok = body.status === "OK" || body.status === "ZERO_RESULTS";
    return NextResponse.json({ ok, status: body.status, error: body.error_message ?? null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
```

- [ ] **Step 3: Command runner (SSE)** — note the five `../`.

```typescript
// apps/web/app/api/setup/run/[step]/route.ts
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { getSettingsRepo } from "../../../../../lib/settings-repo";

// SECURITY BOUNDARY: this endpoint executes shell commands on the host. It is
// only acceptable because the app is self-hosted on a trusted network with no
// auth (spec §7.1, §10.3). Commands are fixed argv arrays keyed by step id —
// never built from request input. Refuses to run once setup is complete unless
// ?rerun=1 is present.
const REPO_ROOT = resolve(process.cwd(), "..", "..");
const INFER = resolve(REPO_ROOT, "services", "inference");
const STEPS: Record<string, { cmd: string; args: string[]; cwd: string }> = {
  migrate: { cmd: "pnpm", args: ["migrate:up"], cwd: resolve(REPO_ROOT, "db") },
  "inference-venv": { cmd: "python", args: ["-m", "venv", "venv"], cwd: INFER },
  "inference-deps": { cmd: resolve(INFER, "venv", "Scripts", "pip.exe"), args: ["install", "-r", "requirements.txt"], cwd: INFER },
  "inference-weights": {
    cmd: resolve(INFER, "venv", "Scripts", "python.exe"),
    args: ["-c", "import torch; torch.hub.load('gmberton/MegaLoc','get_trained_model'); import romatch; romatch.roma_outdoor(device='cpu')"],
    cwd: INFER,
  },
};

export async function POST(request: Request, { params }: { params: { step: string } }) {
  const step = STEPS[params.step];
  if (!step) return new Response("unknown step", { status: 404 });

  const rerun = new URL(request.url).searchParams.get("rerun") === "1";
  if (!rerun && (await getSettingsRepo().isSetupCompleted())) {
    return new Response("setup already completed", { status: 403 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (e: object) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      // shell:true so `pnpm`/`python` resolve on Windows (pnpm is pnpm.cmd).
      // argv is fixed data (see security note), so shell use is not an injection vector.
      const child = spawn(step.cmd, step.args, { cwd: step.cwd, shell: true });
      child.stdout.on("data", (d) => send({ type: "log", line: d.toString() }));
      child.stderr.on("data", (d) => send({ type: "log", line: d.toString() }));
      child.on("error", (err) => { send({ type: "log", line: `error: ${err.message}` }); send({ type: "done", code: 1 }); controller.close(); });
      child.on("close", (code) => { send({ type: "done", code: code ?? 0 }); controller.close(); });
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
  });
}
```

- [ ] **Step 4: Manual verification**

`pnpm dev`, then: `curl /api/setup/prereqs | jq` (returns the four checks); `curl -X POST /api/setup/test-key -d '{"key":"BADKEY"}' -H 'content-type: application/json'` → `{ ok:false, status:"REQUEST_DENIED" }`; `curl -N -X POST /api/setup/run/migrate` streams `data: {"type":"log",...}` lines then `data: {"type":"done","code":0}` and the migrations apply.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/setup
git commit -m "feat(setup): prereq checks, credential test, and SSE command runner (spec §7.1, §10.3, §14.2)"
```

---

### Task 3: `useCommandRun` hook + `RunConsole`

**Files:** Create `apps/web/app/lib/useCommandRun.ts`, `apps/web/app/components/RunConsole.tsx`.

**Interfaces:**
- Produces: `useCommandRun()` → `{ lines, running, done, code, run(step, rerun?) }`; `<RunConsole lines={string[]} />`.

- [ ] **Step 1: Implement `useCommandRun.ts`** (POST + stream reader; verified manually)

```typescript
// apps/web/app/lib/useCommandRun.ts
"use client";
import { useCallback, useState } from "react";
import { parseRunEvent } from "./run-log";

export function useCommandRun() {
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [code, setCode] = useState<number | null>(null);

  const run = useCallback(async (step: string, rerun = false) => {
    setLines([]); setRunning(true); setDone(false); setCode(null);
    const res = await fetch(`/api/setup/run/${step}${rerun ? "?rerun=1" : ""}`, { method: "POST" });
    if (!res.ok || !res.body) {
      setLines((l) => [...l, `error: HTTP ${res.status}`]); setRunning(false); setDone(true); setCode(1);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const data = part.replace(/^data: /, "");
        const ev = parseRunEvent(data);
        if (!ev) continue;
        if (ev.type === "log") setLines((l) => [...l, ev.line]);
        else { setDone(true); setCode(ev.code); setRunning(false); }
      }
    }
    setRunning(false);
  }, []);

  return { lines, running, done, code, run };
}
```

- [ ] **Step 2: Implement `RunConsole.tsx`** (translucent auto-scroll log)

```tsx
// apps/web/app/components/RunConsole.tsx
"use client";
import { useEffect, useRef } from "react";

export function RunConsole({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [lines]);
  if (lines.length === 0) return null;
  return (
    <pre ref={ref}
      className="mt-3 max-h-56 overflow-y-auto rounded-md border border-white/10 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-muted backdrop-blur-md">
      {lines.join("")}
    </pre>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/lib/useCommandRun.ts apps/web/app/components/RunConsole.tsx
git commit -m "feat(setup): useCommandRun SSE reader + translucent RunConsole"
```

---

### Task 4: Wizard shell + step components

**Files:** Create `apps/web/app/setup/SetupWizard.tsx`, `steps/PrereqsStep.tsx`, `steps/MigrateStep.tsx`, `steps/CredentialsStep.tsx`, `steps/InferenceStep.tsx`, `steps/ConfirmStep.tsx`; Modify `apps/web/app/setup/page.tsx`.

**Interfaces:**
- Consumes: `WIZARD_STEPS`/`nextStep`/`prevStep`, `useCommandRun`, `RunConsole`, `FloatingCard`, `GET /api/setup/prereqs`, `POST /api/setup/test-key`, the existing `submitSetup`/`completeSetup` action, `SETTINGS_SCHEMA`.

- [ ] **Step 1: Shell (`SetupWizard.tsx`)** — client component holding `current: StepId`, a left step list (title + ✅ once each step reports done), and the active step panel; per-step "Siguiente"/"Atrás". Completion state is tracked per step in a `Record<StepId, boolean>`; "Siguiente" is disabled until the active step marks itself complete via an `onComplete` callback passed to each step.

```tsx
// apps/web/app/setup/SetupWizard.tsx
"use client";
import { useState } from "react";
import { FloatingCard } from "../components/FloatingCard";
import { WIZARD_STEPS, nextStep, prevStep, type StepId } from "./wizard-steps";
import { PrereqsStep } from "./steps/PrereqsStep";
import { MigrateStep } from "./steps/MigrateStep";
import { CredentialsStep } from "./steps/CredentialsStep";
import { InferenceStep } from "./steps/InferenceStep";
import { ConfirmStep } from "./steps/ConfirmStep";

export function SetupWizard() {
  const [current, setCurrent] = useState<StepId>("prereqs");
  const [done, setDone] = useState<Record<string, boolean>>({});
  const mark = (id: StepId) => setDone((d) => ({ ...d, [id]: true }));

  const panel = {
    prereqs: <PrereqsStep onComplete={() => mark("prereqs")} />,
    migrate: <MigrateStep onComplete={() => mark("migrate")} />,
    credentials: <CredentialsStep onComplete={() => mark("credentials")} />,
    inference: <InferenceStep onComplete={() => mark("inference")} />,
    confirm: <ConfirmStep />,
  }[current];

  const next = nextStep(current);
  const prev = prevStep(current);

  return (
    <div className="mx-auto flex max-w-3xl gap-6 p-8">
      <ol className="w-48 shrink-0 space-y-1">
        {WIZARD_STEPS.map((s, i) => (
          <li key={s.id} className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs ${s.id === current ? "bg-white/10 text-fg" : "text-muted"}`}>
            <span className={done[s.id] ? "text-accent-fg" : "text-subtle"}>{done[s.id] ? "✓" : i + 1}</span>
            {s.title}
          </li>
        ))}
      </ol>
      <div className="flex-1">
        <FloatingCard className="p-6">{panel}</FloatingCard>
        <div className="mt-4 flex justify-between">
          <button onClick={() => prev && setCurrent(prev)} disabled={!prev}
            className="rounded-md border border-white/10 px-4 py-2 text-xs text-fg disabled:opacity-40">Atrás</button>
          {next && (
            <button onClick={() => next && setCurrent(next)} disabled={!done[current]}
              className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-40">Siguiente</button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `PrereqsStep.tsx`** — fetches `/api/setup/prereqs`, lists each check with ✅/❌ + detail + a "Reintentar" button; calls `onComplete()` when Postgres is reachable (pgvector/postgis may still be ❌ — fixed by the migrate step; inference ❌ is fixed by the inference step).

```tsx
// apps/web/app/setup/steps/PrereqsStep.tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "../../lib/fetch-json";

interface Check { id: string; label: string; ok: boolean; detail: string }
export function PrereqsStep({ onComplete }: { onComplete: () => void }) {
  const [checks, setChecks] = useState<Check[]>([]);
  const load = useCallback(async () => {
    const { data } = await fetchJson<{ checks: Check[] }>("/api/setup/prereqs");
    const c = data?.checks ?? [];
    setChecks(c);
    if (c.find((x) => x.id === "postgres")?.ok) onComplete();
  }, [onComplete]);
  useEffect(() => { load(); }, [load]);
  return (
    <div>
      <h2 className="text-sm font-medium text-fg">Prerequisitos</h2>
      <ul className="mt-3 space-y-2">
        {checks.map((c) => (
          <li key={c.id} className="flex items-center justify-between text-xs">
            <span className="text-fg">{c.label}</span>
            <span className={c.ok ? "text-accent-fg" : "text-danger-fg"}>{c.ok ? "✓" : "✕"} {c.detail}</span>
          </li>
        ))}
      </ul>
      <button onClick={load} className="mt-4 rounded-md border border-white/10 px-3 py-1.5 text-xs text-fg hover:bg-white/10">Reintentar</button>
    </div>
  );
}
```

- [ ] **Step 3: `MigrateStep.tsx` + `InferenceStep.tsx`** — each uses `useCommandRun` + `RunConsole`. Migrate: one "Aplicar migraciones" button → `run("migrate")`; `onComplete()` when `done && code === 0`. Inference: three sequential buttons (`inference-venv` → `inference-deps` → `inference-weights`), each enabled once the previous is done+0, sharing one console; `onComplete()` after weights finish 0.

```tsx
// apps/web/app/setup/steps/MigrateStep.tsx
"use client";
import { useEffect } from "react";
import { useCommandRun } from "../../lib/useCommandRun";
import { RunConsole } from "../../components/RunConsole";
export function MigrateStep({ onComplete }: { onComplete: () => void }) {
  const { lines, running, done, code, run } = useCommandRun();
  useEffect(() => { if (done && code === 0) onComplete(); }, [done, code, onComplete]);
  return (
    <div>
      <h2 className="text-sm font-medium text-fg">Base de datos</h2>
      <p className="mt-1 text-xs text-muted">Crea las tablas y las extensiones vector/PostGIS.</p>
      <button onClick={() => run("migrate")} disabled={running}
        className="mt-3 rounded-md bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50">
        {running ? "Aplicando…" : done && code === 0 ? "Aplicado ✓" : "Aplicar migraciones"}
      </button>
      <RunConsole lines={lines} />
    </div>
  );
}
```
> `InferenceStep.tsx` follows the same shape with three `run(...)` calls chained on each other's `done && code === 0`; weights is the long one (~2GB) — the console gives live feedback. (Full code mirrors `MigrateStep`; repeat per button.)

- [ ] **Step 4: `CredentialsStep.tsx`** — the Google key field with a "Probar" button hitting `POST /api/setup/test-key` (green ✓ / red error), Mapbox optional, limits + the free-tier fields. It collects values into wizard-held state and calls `onComplete()` once the Google key tests OK; the actual write happens at Confirm (so nothing persists until the user finishes).

- [ ] **Step 5: `ConfirmStep.tsx`** — summary of collected values → "Finalizar setup" calls the existing setup action (which writes all `system_settings` + `__setup_completed__ = true` in one transaction), then `router.push("/")`. (Wire the collected credential/limit values through from `CredentialsStep` via wizard state or a shared context.)

- [ ] **Step 6: Mount the wizard**

```tsx
// apps/web/app/setup/page.tsx
import { SetupWizard } from "./SetupWizard";
export default function SetupPage() {
  return <main className="min-h-screen"><SetupWizard /></main>;
}
```

- [ ] **Step 7: Full manual verification** — from a fresh DB (setup not completed): any route redirects to `/setup`; the wizard walks prereqs → migrate (logs stream, extensions/tables created, pgvector/postgis now ✅ on re-check) → credentials (bad key shows error, good key ✓) → inference (venv → deps → weights stream; the inference service becomes reachable) → confirm (writes settings, marks complete, lands on `/`). Re-visiting `/setup` after completion: the runner returns 403 unless `?rerun=1`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/setup
git commit -m "feat(setup): step-by-step wizard UI with live install logs (spec §14.2)"
```

---

## Self-Review

- **Spec coverage:** §14.2 multi-step first-run setup ✔ (all tasks); §7.1 Windows-native command execution (shell:true, venv exe paths) ✔; §10.3 trusted-network runner assumption documented ✔; credentials tested with a real (free) metadata call ✔; migrations + extensions created from the UI ✔; inference deps + weights installed with live logs ✔.
- **Supersedes & fixes:** Tasks 13–14 of `2026-07-09-ui-refinement-onboarding-cost.md`, with the corrected `../../../../lib` / `../../../../../lib` import depths (the terser version's wrong paths were the `Cannot find module '../../../lib/db'` typecheck error).
- **Security:** runner commands are fixed argv keyed by step, gated to pre-setup unless `?rerun=1`, documented trusted-network assumption. `test-key` uses the free metadata endpoint (no cost).
- **Type/flow consistency:** `RunEvent`/`parseRunEvent` (Task 1) → `useCommandRun` (Task 3) → step components (Task 4). `StepId` drives the shell. Persistence deferred to Confirm so a half-finished wizard writes nothing.
- **Manual-only:** child-process runner, SSE reader, and forms are verified manually; step machine + log parser are unit-tested.

## Execution Handoff

Plan complete, saved to `docs/2026-07-10-setup-wizard-ui.md`. It's the heaviest/most security-sensitive plan — review the runner's posture before merge. Subagent-driven (recommended) or inline execution.
