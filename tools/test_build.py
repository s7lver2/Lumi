# tools/test_build.py
import zipfile
from pathlib import Path

from build import stage_bundle, make_zip


def _make_fake_repo(tmp_path: Path) -> Path:
    root = tmp_path / "fake-repo"
    (root / "apps/web/app").mkdir(parents=True)
    (root / "apps/web/app/page.tsx").write_text("export default function Page() {}", encoding="utf-8")
    (root / "apps/web/node_modules/some-pkg").mkdir(parents=True)
    (root / "apps/web/node_modules/some-pkg/index.js").write_text("module.exports = {}", encoding="utf-8")
    (root / "services/inference/venv/lib").mkdir(parents=True)
    (root / "services/inference/venv/lib/site.py").write_text("# venv file, must not be bundled", encoding="utf-8")
    (root / "services/inference/main.py").write_text("# real source file", encoding="utf-8")
    (root / "package.json").write_text('{"name": "fake", "version": "9.9.9"}', encoding="utf-8")
    return root


def test_stage_bundle_copies_source_and_skips_excluded_dirs(tmp_path, monkeypatch):
    root = _make_fake_repo(tmp_path)
    monkeypatch.setattr("build.BUNDLE_INCLUDE", ["apps/web", "services/inference", "package.json"])
    staging = tmp_path / "staging"

    stage_bundle(root, staging)

    assert (staging / "apps/web/app/page.tsx").exists()
    assert (staging / "services/inference/main.py").exists()
    assert (staging / "package.json").exists()
    assert not (staging / "apps/web/node_modules").exists()
    assert not (staging / "services/inference/venv").exists()


def test_make_zip_contains_every_staged_file(tmp_path):
    staging = tmp_path / "lumi-9.9.9"
    (staging / "a").mkdir(parents=True)
    (staging / "a" / "one.txt").write_text("1", encoding="utf-8")
    (staging / "two.txt").write_text("2", encoding="utf-8")
    zip_path = tmp_path / "out.zip"

    result = make_zip(staging, zip_path)

    assert result == zip_path
    with zipfile.ZipFile(zip_path) as zf:
        names = set(zf.namelist())
    assert "lumi-9.9.9/a/one.txt" in names
    assert "lumi-9.9.9/two.txt" in names