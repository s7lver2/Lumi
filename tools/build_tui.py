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
