"""The data seam. Every value carries its source and date so the model can cite it.

The first implementation reads files the user maintains (data/manual). A live
provider (exchange feed, disclosures, central-bank rates) can replace it later
without touching the tools, as long as it returns the same shapes.
"""

from dataclasses import asdict, dataclass, field
from typing import Protocol


@dataclass(frozen=True)
class Sourced:
    value: float
    as_of: str
    source: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class FinancialPeriod:
    period: str
    period_end: str
    source: str
    data: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class Financials:
    symbol: str
    currency: str
    unit: str
    periods: list[FinancialPeriod]

    @property
    def latest(self) -> FinancialPeriod | None:
        return max(self.periods, key=lambda p: p.period_end) if self.periods else None


@dataclass(frozen=True)
class Event:
    symbol: str
    date: str
    type: str
    description: str
    source: str


class DataProvider(Protocol):
    name: str

    def get_price(self, symbol: str) -> Sourced | None: ...

    def get_price_history(self, symbol: str) -> list[Sourced]: ...

    def get_financials(self, symbol: str) -> Financials | None: ...

    def get_macro(self) -> dict[str, Sourced]: ...

    def get_events(self, symbol: str, since: str | None = None) -> list[Event]: ...
