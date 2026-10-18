"""Provider that prefers the synced market cache for prices and falls back to the manual files.

Financials, macro inputs and events still come from data/manual: EODHD's cached data covers
prices only.
"""

from contextlib import closing
from ..config import db_path
from ..market import store
from ..market.calendar import now_cairo
from ..store.db import connect
from ..universe import normalize_symbol
from .manual import ManualProvider
from .provider import Event, Financials, Sourced


class CachedMarketProvider:
    name = "market-cache+manual"

    def __init__(self, manual: ManualProvider):
        self.manual = manual

    def _conn(self):
        return closing(connect(db_path()))

    def get_price(self, symbol: str) -> Sourced | None:
        # Same rule as the market list and the portfolio (market.summary.price_state).
        from ..market.summary import price_state, sourced_price
        symbol = normalize_symbol(symbol)
        with self._conn() as conn:
            price = sourced_price(price_state(conn, symbol, now_cairo()))
        return price or self.manual.get_price(symbol)

    def get_price_history(self, symbol: str) -> list[Sourced]:
        symbol = normalize_symbol(symbol)
        with self._conn() as conn:
            rows = store.bars(conn, symbol)
        if rows:
            return [Sourced(r["close"], r["date"], f"{r['source']} daily close") for r in rows]
        return self.manual.get_price_history(symbol)

    def get_financials(self, symbol: str) -> Financials | None:
        return self.manual.get_financials(symbol)

    def get_macro(self) -> dict[str, Sourced]:
        return self.manual.get_macro()

    def get_events(self, symbol: str, since: str | None = None) -> list[Event]:
        return self.manual.get_events(symbol, since)
