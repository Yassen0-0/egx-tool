import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def data_dir() -> Path:
    return Path(os.environ.get("EGX_DATA_DIR", REPO_ROOT / "data"))


def db_path() -> Path:
    return Path(os.environ.get("EGX_DB_PATH", data_dir() / "egx.sqlite"))
