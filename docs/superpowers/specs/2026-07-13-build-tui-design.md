# tools/build.py TUI — design spec

Status: approved (design phase) — implementation not started.
Independent of the other 2026-07-13 design specs (low-VRAM mode, dataset
catalog) — no shared dependencies.

## Context

`python3 tools/build.py` (no subcommand) is the dev-mode entry point: it
brings up Postgres, runs migrations, then starts inference/worker/web with
each process's output tagged (`[inference]`, `[worker]`, `[web]`) and
interleaved into one scrolling terminal (a feature added earlier today).
Reading one service's output means visually filtering it out of the other
two's interleaved lines, and there's no way to stop/restart an individual
service without killing the whole `dev()` invocation.

This spec adds a real, persistent terminal UI (TUI) dashboard — not a
one-time checklist — with checkboxes to start/stop inference/worker/web
individually while the dashboard stays on screen, and a separate log pane
per service instead of one interleaved feed.

## Goals

- `python3 tools/build.py --tui` launches an interactive, persistent
  dashboard (opt-in — see Non-goals) styled after lazydocker: a sidebar
  list of services with checkboxes + status, and a main pane showing the
  selected service's own log output.
- Checking/unchecking inference/worker/web actually starts/stops that
  service's real OS process, live, while the dashboard is running.
- A service that crashes on its own reflects that in its checkbox/status,
  not just silently stop logging.
- Reuses the existing process-spawning and log-file-teeing logic — no
  duplicated argv-building or tee/truncation code between the plain and
  TUI modes.

## Non-goals

- Postgres and migrations are NOT toggleable — Postgres starts
  automatically and stays up for the dashboard's lifetime (other services
  depend on it); migrations run once at startup exactly as today, before
  the dashboard takes over the screen.
- `--tui` is opt-in, not the default. Plain `python3 tools/build.py`
  (no flag) is unchanged — same scrolling `[tag]`-prefixed output as
  today. A TUI needs a real TTY and would hang or error under any
  non-interactive/scripted invocation (including the kind of subagent
  smoke-tests used to verify this exact codebase earlier today).
- No remote/multi-machine dashboard, no web-based UI — terminal only.
- No packaging/distribution change — this is a dev-only tool, not part of
  the installer or the compiled `lumi` binary (`tools/templates/
  lumi_launcher.py` is untouched by this spec).

## Architecture

**Library: Textual** (Textualize/Rich's TUI framework). Chosen over Rich
alone (no built-in interactive widgets or input handling — would mean
hand-rolling raw keyboard reads per platform) and `curses` (poor Windows
support — needs the separate `windows-curses` package anyway, so "no new
dependency" isn't even true there, and this project's primary deployment
target is Windows). Dev-only dependency (not shipped in the packaged
installer), so adding it costs nothing at distribution time.

**Entry point:** `tools/build.py` gains a `--tui` argparse flag on the
no-subcommand path. When passed, the existing pre-service startup sequence
(`.env` creation, `docker compose up -d --build db`, migrations) runs
exactly as it does today, printed to the plain terminal — only after that
succeeds does control pass to a new `tools/build_tui.py` module, which
takes over the screen.

**New file — `tools/build_tui.py`:**
- `ServiceSpec`: name/tag, an argv-builder callable, cwd, env — built from
  the exact same logic `dev()` already uses (e.g. inference's venv-exists
  check, its venv/bin vs venv/Scripts path resolution).
- `ServiceState`: the current `Popen` handle (or `None` if stopped), an
  in-memory buffer of that service's own tagged lines (no `[tag]` prefix
  needed since each pane is already scoped to one service), and a
  running/stopped/crashed status.
- `LumiDevApp(textual.app.App)`:
  - Sidebar (`ListView` or `OptionList`): one row per service — checkbox,
    name, status dot (● running / ○ stopped / ✕ crashed).
  - Main pane: a `Log`/`RichLog` widget rendering the selected service's
    buffer.
  - On mount: inference's checkbox starts disabled with an inline note if
    no venv exists (mirrors today's "venv no existe, se omite" skip
    message); otherwise inference/worker/web all default checked and
    auto-start, matching `dev()`'s current default of starting everything.
  - Checkbox toggle (checked → start): builds argv via the shared
    `ServiceSpec`, spawns via the existing tee-aware pump (see below), and
    begins filling that service's buffer.
  - Checkbox toggle (unchecked → stop): terminates the process (SIGTERM,
    wait with timeout, SIGKILL fallback — same teardown `dev()`'s
    `finally` block already does), keeping the buffered scrollback visible
    until re-checked (re-checking clears the buffer and starts fresh).
  - Selecting a different sidebar row swaps the main pane's content to
    that service's buffer — no re-fetching, just switching which buffer is
    rendered.
  - Keybindings: `space` (toggle selected), `↑`/`↓` (navigate), `r`
    (restart selected: stop then start), `q` (quit — gracefully stops
    every currently-running service, same teardown as today, then exits).
  - A periodic timer (Textual's built-in interval mechanism) calls
    `Popen.poll()` on every running service; a process that has exited on
    its own (not via a user-initiated stop) flips that service's status to
    crashed and its checkbox to unchecked, rather than silently going
    quiet while still showing as "running."

**Shared-core refactor (`tools/build.py`):** `_pump_tagged` gains one new
optional parameter: `on_line: Callable[[str], None] | None = None`. When
`None` (the default — used by today's plain `dev()` path), behavior is
byte-for-byte unchanged: `print(f"[{tag}] {line}")`. When provided (the
TUI path), each line is handed to the callback instead of being printed —
which the TUI wires to append to that service's `ServiceState` buffer
(and re-render the pane if it's the one currently selected). The
log-file-teeing and periodic size-truncation logic already inside
`_pump_tagged` (from earlier today's work) is completely unchanged and
shared between both modes — zero duplication.

## Data flow

`python3 tools/build.py --tui` → `.env`/Postgres/migrations run on the
plain terminal exactly as today → Textual app takes over the screen →
checked services (inference if venv exists, worker, web) auto-start, each
streaming into its own buffer via the shared tee-aware pump → user
toggles/selects/restarts via keyboard → `q` (or Ctrl+C, mapped to the same
action) tears down every running service before the terminal is restored
to normal.

## Error handling

- A service crashing unprompted is detected via the periodic
  `Popen.poll()` reconciliation described above — its checkbox/status
  updates automatically, it never silently shows "running" with a dead
  process behind it.
- Docker/migration failures in the pre-TUI sequence abort with the same
  message `dev()` prints today, before the Textual app ever launches.
- Ctrl+C while the dashboard is active is bound to the same graceful
  teardown as pressing `q` (no orphaned child processes left behind) —
  explicit, since Textual's default SIGINT handling needs this wired
  rather than assumed.

## Testing

- `_pump_tagged`'s new `on_line` parameter: a direct smoke test (same
  style as earlier today's) confirming (a) default behavior is unchanged
  when `on_line` is omitted (lines are printed, not silently dropped), and
  (b) a supplied callback receives every line instead of it being printed.
- `tools/build_tui.py`: Textual ships `textual.testing`'s `Pilot` for
  driving an app via simulated key presses in tests — new to this project
  (no existing Textual usage), so the implementation plan introduces this
  testing pattern from scratch. Planned `Pilot`-driven tests: toggling a
  service's checkbox actually starts/stops a (dummy, test-only) subprocess;
  selecting a different service swaps the visible pane's content; quitting
  stops every running service.
- Manual verification: actually running `python3 tools/build.py --tui`
  and interacting with it — some aspects of real terminal rendering aren't
  fully covered by Pilot-driven assertions alone.
