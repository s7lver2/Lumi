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
