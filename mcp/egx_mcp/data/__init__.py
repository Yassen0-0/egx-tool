from ..config import data_dir
from .manual import ManualProvider
from .provider import DataProvider


def default_provider() -> DataProvider:
    return ManualProvider(data_dir() / "manual")
