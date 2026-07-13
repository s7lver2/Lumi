# Startup loading / crash screens — design spec

Status: approved (design phase) — implementation not started.
Related: feature #1 (`2026-07-13-low-vram-mode-design.md`)'s "Reiniciar ahora"
button navigates into this screen while the inference service restarts.

## Context

Lumi is three processes: `apps/web` (Next.js), `apps/worker` (pg-boss
consumer, no HTTP surface), `services/inference` (FastAPI/uvicorn). Opening
`localhost:3000` before worker/inference finish starting today just shows a
broken/incomplete UI with no explanation, and there's no way to tell the user
one of those processes crashed.

There's already a `BootGate` component (`apps/web/app/components/
LoadingScreen.tsx`) wired into `(protected)/layout.tsx`, with a branded
starfield/planet/orbiting-satellite background (`PlanetBackground.tsx`). It's
cosmetic only today — it fires one `fetch("/api/map-config")` and marks
itself ready regardless of the response, never checking worker or inference
at all. This spec gives it real teeth instead of replacing it, and adds the
crash counterpart it's missing.

`/setup` is a sibling route to `(protected)`, not inside it — this gate
doesn't need to special-case it.

## Goals

- Accurate, live "is everything actually up" status covering all three
  processes, visible from any page under `(protected)`.
- A loading screen while services are still starting (expected, temporary).
- A crash screen, with the real error, when a service has actually failed.
- Both states reuse Lumi's existing visual identity (`PlanetBackground`)
  rather than introducing an unrelated illustration style.

## Non-goals

- Auto-restarting a crashed service (the user acts via "Reintentar" or
  Settings; feature #1 already covers restarting inference specifically).
- Health-checking anything on `/setup` itself.
- A generic alerting/observability system — this is a UX screen, not
  monitoring infrastructure.

## Health signals

- **Web**: trivially healthy if this code is running at all.
- **Inference**: reuses the existing `/docs` HTTP reachability check
  already used by the setup wizard (`prereqs`/`verify-services` routes) —
  no new mechanism.
- **Worker**: new singleton `worker_heartbeat(updated_at timestamptz)` row
  (new migration). `main()` in `apps/worker/src/index.ts` touches it via
  `setInterval` every ~5s. Chosen over giving the worker its own HTTP server
  (an explicit existing design choice against that) or inferring liveness
  from the job queue (too indirect/slow to detect a crash) — a DB row also
  works regardless of which supervisor started the worker or whether it's
  ever on a different machine, matching this app's existing DB-centric,
  no-Redis architecture.

## Loading vs. crashed

Both are "not healthy right now" — the difference is whether it's still
expected to come up. Resolved with a simple elapsed-time heuristic, tracked
from when `/api/health` first observes a service as down:

- Inference: generous allowance (~90s) — cold model/CUDA loading is slow.
- Worker: shorter allowance (~20s) — nothing heavy to load at boot.

Within the allowance → **loading**. Beyond it → **crashed**. No pidfile or
process-tracking needed for this; deliberately kept simple.

## Crash error source

Extends today's tagged-logging work (`tools/build.py`'s `_pump_tagged`,
`tools/templates/lumi_launcher.py`'s equivalent) so each supervised
process's output is also teed to `data/logs/{worker,inference}.log`, not
just printed to the terminal. A new `GET /api/health/logs?service=worker|
inference` tails the last ~50 lines for the crash screen's log panel.

## API

- `GET /api/health` → `{ web: "ready", worker: "ready"|"loading"|"crashed", inference: "ready"|"loading"|"crashed" }`.
  `BootGate` polls this every ~2s while not fully ready.
- `GET /api/health/logs?service=worker|inference` → `{ lines: string[] }`,
  tailing the corresponding log file. Only called once a service is
  reported crashed (not polled continuously).

## UI

**Loading state** (replaces `BootGate`'s current placeholder ping):
`PlanetBackground` unchanged (planet spinning, satellite orbiting) + "Lumi /
Preparando tu espacio de trabajo…" + shimmer bar, all as today. New: a
three-chip **preflight row** below the shimmer (Web / Worker / Inferencia),
each a custom icon (browser window / stacked-layers queue / aperture — not
generic dots) inside a ring that pulses dashed while pending and resolves to
a solid ring + checkmark badge once ready.

**Crashed state**: same `PlanetBackground`, but the orbit breaks — a dashed
arc marks the path the satellite dropped off, and the satellite itself
drifts away with a fading trail in the same amber used for the failed
ring, instead of the background just freezing generically. The crash icon
is a small satellite glyph with one link visibly cut, not a stock alert
triangle. The same preflight row reappears so the failed service is
identifiable at a glance (its ring turns amber with an error badge) before
reading the log panel below, which shows the tailed log text with the fatal
line highlighted. Actions: **"Reintentar"** (re-polls `/api/health`
immediately) and **"Ver ajustes"** (in case the fix is a Settings change,
e.g. feature #1's low-VRAM toggle).

Mockup (approved, both states, served locally during design — not persisted
as a public artifact URL): `boot-gate-mockup.html` in this session's
scratchpad.

## Testing

- `apps/worker`: unit test that the heartbeat interval writes on the
  expected cadence (fake timers).
- `apps/web`: unit test `/api/health`'s loading-vs-crashed timeout logic
  with mocked clocks and mocked inference/heartbeat responses.
- Manual: kill inference mid-session, confirm the crash screen appears
  within the ~90s allowance with the real traceback visible; restart it,
  confirm `BootGate` recovers without a page reload.
