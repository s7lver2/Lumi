"""
Textual-based live dashboard for `python3 tools/build.py --tui` (spec:
docs/superpowers/specs/2026-07-13-build-tui-design.md). Only inference/
worker/web are toggleable services here — Postgres and migrations run
once, non-interactively, in tools/build.py before this module's App ever
takes over the screen (see run_tui() in Task 5).
"""
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

IS_WIN = sys.platform == "win32"


@dataclass
class ServiceSpec:
    """What it takes to start one toggleable dev-mode service. Built once
    by build_service_specs(), then reused every time LumiDevApp starts or
    restarts that service."""
    name: str
    argv: list[str]
    cwd: Path
    shell: bool = False
    env: dict | None = None
    available: bool = True
    unavailable_reason: str = ""


@dataclass
class ServiceState:
    """Live, mutable state for one service while the dashboard is running."""
    spec: ServiceSpec
    proc: subprocess.Popen | None = None
    buffer: list[str] = field(default_factory=list)
    status: str = "stopped"  # "stopped" | "running" | "crashed"


def build_service_specs(root: Path) -> list[ServiceSpec]:
    """Mirrors tools/build.py's dev()'s existing inference/worker/web argv
    construction exactly, as plain data instead of immediately spawning —
    lets LumiDevApp start/stop each service on demand instead of all at
    once at process launch."""
    infer_dir = root / "services" / "inference"
    venv = infer_dir / "venv"
    if venv.exists():
        python_exe = venv / ("Scripts/python.exe" if IS_WIN else "bin/python")
        inference = ServiceSpec(
            name="inference",
            argv=[str(python_exe), "-m", "uvicorn", "main:app", "--reload", "--host", "0.0.0.0", "--port", "8000"],
            cwd=infer_dir,
        )
    else:
        inference = ServiceSpec(
            name="inference", argv=[], cwd=infer_dir, available=False,
            unavailable_reason=f"{venv} no existe todavía — completa /setup para instalarlo.",
        )

    worker = ServiceSpec(
        name="worker", argv=["pnpm", "--filter", "@netryx/worker", "start"], cwd=root, shell=IS_WIN,
    )
    web = ServiceSpec(
        name="web", argv=["pnpm", "--filter", "@netryx/web", "dev"], cwd=root, shell=IS_WIN,
    )
    return [inference, worker, web]


from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.widgets import Checkbox, Label, ListItem, ListView, RichLog

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import _popen_tagged  # noqa: E402 — reuse the shared, tee-aware spawner

STATUS_DOT = {"running": "●", "stopped": "○", "crashed": "✕"}


def _status_text(state: ServiceState) -> str:
    if not state.spec.available:
        return state.spec.unavailable_reason
    return f"{STATUS_DOT[state.status]} {state.status}"


class LumiDevApp(App):
    # Plain text, no themed background fills — reads as a terminal program,
    # not a colorful modern TUI. Selection/hover state is shown via reverse
    # video (text-style) instead of a colored background block, and borders
    # use plain ascii (+/-/|) instead of themed Unicode line art.
    CSS = """
    Screen {
        background: transparent;
        scrollbar-size: 0 0;
    }
    Horizontal { height: 1fr; }
    #sidebar { width: 34; border: ascii white; background: transparent; margin: 0 1 0 0; }
    #log-pane { border: ascii white; background: transparent; }

    ListView {
        background: transparent !important;
        scrollbar-size: 0 0;
        & > ListItem {
            background: transparent !important;
            &.-hovered { background: transparent !important; text-style: underline; }
            &.-highlight { background: transparent !important; text-style: bold reverse; }
        }
        &:focus > ListItem.-highlight { background: transparent !important; text-style: bold reverse; }
    }

    Checkbox {
        border: none;
        background: transparent !important;
        & > .toggle--button { background: transparent !important; }
        &:focus { border: none; background-tint: transparent; }
    }

    RichLog {
        background: transparent !important;
        scrollbar-size: 1 1;
        scrollbar-color: white 40%;
        scrollbar-color-hover: white 60%;
        scrollbar-color-active: white;
        scrollbar-background: transparent;
        scrollbar-background-hover: transparent;
        scrollbar-background-active: transparent;
        scrollbar-corner-color: transparent;
    }
    """

    BINDINGS = [
        Binding("space", "toggle_selected", "Alternar"),
        Binding("r", "restart_selected", "Reiniciar"),
        Binding("q", "quit_app", "Salir"),
        # Textual's own App.BINDINGS binds ctrl+c to action_help_quit by
        # default, which would bypass this app's subprocess teardown —
        # explicitly override it to run the same graceful quit instead.
        Binding("ctrl+c", "quit_app", "Salir", priority=True),
    ]

    def __init__(self, root: Path, specs: list[ServiceSpec]) -> None:
        super().__init__()
        self.root = root
        self.states: dict[str, ServiceState] = {s.name: ServiceState(spec=s) for s in specs}
        self.selected_name = specs[0].name

    def compose(self) -> ComposeResult:
        with Horizontal():
            with Vertical(id="sidebar"):
                yield ListView(
                    *[
                        ListItem(
                            Checkbox(
                                name, value=state.spec.available, disabled=not state.spec.available,
                                id=f"checkbox-{name}",
                            ),
                            Label(_status_text(state), id=f"status-{name}"),
                            id=f"row-{name}",
                        )
                        for name, state in self.states.items()
                    ],
                    id="service-list",
                )
            yield RichLog(id="log-pane", highlight=False)

    def on_mount(self) -> None:
        for state in self.states.values():
            if state.spec.available:
                self._start(state)
        self._render_pane(self.selected_name)
        self.set_interval(1.0, self._poll_crashed)

    def _poll_crashed(self) -> None:
        """A service that exited on its own (not via a user-initiated
        stop) should show as crashed, not silently sit at "running" with
        nothing behind it — checked once a second via Popen.poll()."""
        for name, state in self.states.items():
            if state.proc is not None and state.proc.poll() is not None:
                state.proc = None
                state.status = "crashed"
                self._refresh_status(name)
                checkbox = self.query_one(f"#checkbox-{name}", Checkbox)
                checkbox.value = False

    def _append_line(self, name: str, line: str) -> None:
        state = self.states[name]
        state.buffer.append(line)
        if name == self.selected_name:
            self.query_one("#log-pane", RichLog).write(line)

    def _start(self, state: ServiceState) -> None:
        if state.proc is not None or not state.spec.available:
            return
        state.buffer = []
        name = state.spec.name
        state.proc = _popen_tagged(
            state.spec.argv, state.spec.cwd, name,
            shell=state.spec.shell, env=state.spec.env,
            on_line=lambda line, n=name: self.call_from_thread(self._append_line, n, line),
        )
        state.status = "running"
        self._refresh_status(name)
        if name == self.selected_name:
            self.query_one("#log-pane", RichLog).clear()

    def _stop(self, state: ServiceState) -> None:
        if state.proc is None:
            return
        state.proc.terminate()
        try:
            state.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            state.proc.kill()
        state.proc = None
        state.status = "stopped"
        self._refresh_status(state.spec.name)

    def _refresh_status(self, name: str) -> None:
        self.query_one(f"#status-{name}", Label).update(_status_text(self.states[name]))

    def _render_pane(self, name: str) -> None:
        log = self.query_one("#log-pane", RichLog)
        log.clear()
        for line in self.states[name].buffer:
            log.write(line)

    def on_checkbox_changed(self, event: Checkbox.Changed) -> None:
        name = event.checkbox.id.removeprefix("checkbox-")
        state = self.states[name]
        if event.value:
            self._start(state)
        else:
            self._stop(state)

    def on_list_view_selected(self, event: ListView.Selected) -> None:
        name = event.item.id.removeprefix("row-")
        self.selected_name = name
        self._render_pane(name)

    def action_toggle_selected(self) -> None:
        state = self.states[self.selected_name]
        if not state.spec.available:
            return
        checkbox = self.query_one(f"#checkbox-{self.selected_name}", Checkbox)
        checkbox.value = not checkbox.value

    def action_restart_selected(self) -> None:
        state = self.states[self.selected_name]
        if not state.spec.available:
            return
        self._stop(state)
        self._start(state)

    def action_quit_app(self) -> None:
        for state in self.states.values():
            self._stop(state)
        self.exit()
