# tools/lumi_paths.py
"""
Shared pure helpers for tools/build.py (and, in spirit, tools/install.py):
what counts as "the project" for a distributable bundle, and where things
live. No side effects, no subprocess calls — kept separate so it's testable
without touching the filesystem beyond what a test explicitly sets up.
"""
import json
from pathlib import Path

# Repo-relative top-level entries to walk when staging a bundle (Task 2).
# Anything not listed here never makes it into a bundle, regardless of
# BUNDLE_EXCLUDE_DIR_NAMES below (that set only prunes WITHIN these).
BUNDLE_INCLUDE = [
    "apps/web",
    "apps/worker",
    "packages",
    "db",
    "services/inference",
    "docs",
    "tools",
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "docker-compose.yml",
    ".env.example",
    "README.md",
]

# Mirrors .gitignore's intent (repo root .gitignore) — dev-only, generated,
# or multi-GB directories that must never end up in a distributable bundle.
BUNDLE_EXCLUDE_DIR_NAMES = {
    "node_modules",
    ".next",
    "venv",
    "venv-wsl",
    ".pip-cache",
    ".pip-cache-wsl",
    "__pycache__",
    "data",
    ".git",
    "dist",
}


def repo_root() -> Path:
    """tools/lumi_paths.py -> tools -> repo root."""
    return Path(__file__).resolve().parent.parent


def read_version(root: Path) -> str:
    data = json.loads((root / "package.json").read_text(encoding="utf-8"))
    return data["version"]


def should_include(rel_path: Path) -> bool:
    """True if a repo-relative path should be copied into a bundle."""
    return not any(part in BUNDLE_EXCLUDE_DIR_NAMES for part in rel_path.parts)