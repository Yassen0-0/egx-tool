from ..config import data_dir
from .cached import CachedMarketProvider
from .manual import ManualProvider
from .provider import DataProvider


def default_provider() -> DataProvider:
    return CachedMarketProvider(ManualProvider(data_dir() / "manual"))
