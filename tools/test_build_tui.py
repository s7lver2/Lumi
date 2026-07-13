import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_tui import build_service_specs


def test_inference_unavailable_when_venv_missing(tmp_path):
    (tmp_path / "services" / "inference").mkdir(parents=True)
    specs = build_service_specs(tmp_path)
    inference = next(s for s in specs if s.name == "inference")
    assert inference.available is False
    assert "no existe" in inference.unavailable_reason


def test_inference_available_when_venv_exists(tmp_path):
    venv_bin = tmp_path / "services" / "inference" / "venv" / "bin"
    venv_bin.mkdir(parents=True)
    specs = build_service_specs(tmp_path)
    inference = next(s for s in specs if s.name == "inference")
    assert inference.available is True
    assert "uvicorn" in inference.argv
    assert str(venv_bin / "python") in inference.argv


def test_worker_and_web_specs():
    specs = build_service_specs(Path("/fake/root"))
    names = [s.name for s in specs]
    assert names == ["inference", "worker", "web"]
    worker = next(s for s in specs if s.name == "worker")
    web = next(s for s in specs if s.name == "web")
    assert worker.argv == ["pnpm", "--filter", "@netryx/worker", "start"]
    assert web.argv == ["pnpm", "--filter", "@netryx/web", "dev"]


import asyncio
from pathlib import Path

import pytest

from build_tui import LumiDevApp, ServiceSpec


def _dummy_specs() -> list[ServiceSpec]:
    return [
        ServiceSpec(name="inference", argv=[], cwd=Path("."), available=False, unavailable_reason="no venv"),
        ServiceSpec(name="worker", argv=["bash", "-c", "echo worker-line; sleep 5"], cwd=Path(".")),
        ServiceSpec(name="web", argv=["bash", "-c", "echo web-line; sleep 5"], cwd=Path(".")),
    ]


@pytest.mark.asyncio
async def test_toggling_checkbox_stops_and_restarts_a_service():
    app = LumiDevApp(Path("."), _dummy_specs())
    async with app.run_test() as pilot:
        await pilot.pause()
        assert app.states["worker"].status == "running"

        checkbox = app.query_one("#checkbox-worker")
        checkbox.value = False
        await pilot.pause()
        assert app.states["worker"].status == "stopped"
        assert app.states["worker"].proc is None

        checkbox.value = True
        await pilot.pause()
        await asyncio.sleep(0.2)  # let the freshly-spawned process print its line
        assert app.states["worker"].status == "running"
        assert "worker-line" in app.states["worker"].buffer

        for state in app.states.values():
            app._stop(state)


@pytest.mark.asyncio
async def test_selecting_a_different_service_switches_the_visible_pane():
    app = LumiDevApp(Path("."), _dummy_specs())
    async with app.run_test() as pilot:
        await pilot.pause()
        await asyncio.sleep(0.2)
        assert app.selected_name == "inference"  # first spec in the list

        list_view = app.query_one("#service-list")
        list_view.focus()
        await pilot.pause()
        await pilot.press("down")  # move highlight from inference (0) to worker (1)
        await pilot.pause()
        await pilot.press("enter")  # fire the actual Selected event
        await pilot.pause()

        assert app.selected_name == "worker"
        log = app.query_one("#log-pane")
        assert any("worker-line" in str(line) for line in log.lines)

        for state in app.states.values():
            app._stop(state)


@pytest.mark.asyncio
async def test_quit_action_stops_every_running_service():
    app = LumiDevApp(Path("."), _dummy_specs())
    async with app.run_test() as pilot:
        await pilot.pause()
        assert app.states["worker"].proc is not None
        assert app.states["web"].proc is not None

        app.action_quit_app()
        await pilot.pause()
        assert app.states["worker"].proc is None
        assert app.states["web"].proc is None


@pytest.mark.asyncio
async def test_restart_on_unavailable_service_is_a_noop():
    # inference is unavailable (no venv) and is specs[0], so it's the
    # default-selected row on startup — pressing "r" here used to call
    # _start() on a spec with argv == [], crashing with IndexError from
    # subprocess.Popen([]) inside _popen_tagged.
    app = LumiDevApp(Path("."), _dummy_specs())
    async with app.run_test() as pilot:
        await pilot.pause()
        assert app.selected_name == "inference"
        assert app.states["inference"].spec.available is False

        app.action_restart_selected()
        await pilot.pause()

        assert app.states["inference"].proc is None

        for state in app.states.values():
            app._stop(state)


@pytest.mark.asyncio
async def test_toggle_on_unavailable_service_is_a_noop():
    app = LumiDevApp(Path("."), _dummy_specs())
    async with app.run_test() as pilot:
        await pilot.pause()
        assert app.selected_name == "inference"
        assert app.states["inference"].spec.available is False

        app.action_toggle_selected()
        await pilot.pause()

        assert app.states["inference"].proc is None

        for state in app.states.values():
            app._stop(state)
