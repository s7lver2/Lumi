# tools/test_lumi_paths.py
from pathlib import Path

from lumi_paths import should_include, read_version, BUNDLE_EXCLUDE_DIR_NAMES


def test_should_include_excludes_node_modules():
    assert should_include(Path("apps/web/node_modules/foo.js")) is False


def test_should_include_excludes_native_and_wsl_venvs():
    assert should_include(Path("services/inference/venv/lib/x.py")) is False
    assert should_include(Path("services/inference/venv-wsl/lib/x.py")) is False


def test_should_include_excludes_pip_caches():
    assert should_include(Path("services/inference/.pip-cache/x.whl")) is False
    assert should_include(Path("services/inference/.pip-cache-wsl/x.whl")) is False


def test_should_include_excludes_data_and_dist_and_git():
    assert should_include(Path("data/models-cache/torch/hub/x")) is False
    assert should_include(Path("dist/lumi-0.1.0.zip")) is False
    assert should_include(Path(".git/HEAD")) is False


def test_should_include_keeps_normal_source():
    assert should_include(Path("apps/web/app/page.tsx")) is True
    assert should_include(Path("services/inference/main.py")) is True


def test_read_version_reads_package_json(tmp_path):
    (tmp_path / "package.json").write_text('{"name": "netryx-fork", "version": "1.2.3"}', encoding="utf-8")
    assert read_version(tmp_path) == "1.2.3"


def test_exclude_set_matches_gitignore_intent():
    # Every folder .gitignore already excludes for these exact reasons must
    # also be excluded from the bundle — see .gitignore at the repo root.
    for name in ["node_modules", ".next", "venv", "venv-wsl", ".pip-cache", ".pip-cache-wsl", "__pycache__", "data", ".git", "dist"]:
        assert name in BUNDLE_EXCLUDE_DIR_NAMES