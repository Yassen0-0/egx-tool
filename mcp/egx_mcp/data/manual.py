"""Provider backed by files the user edits by hand under data/manual.

    prices.csv              symbol,price,date,source        (one row per observation)
    macro.json              {"risk_free_rate_egp": {"value", "as_of", "source"}, ...}
    events.csv              symbol,date,type,description,source
    financials/<SYM>.json   {"currency", "unit", "periods": [{"period", "period_end", "source", "data": {...}}]}
"""

import csv
import json
from pathlib import Path

from ..universe import normalize_symbol
from .provider import Event, FinancialPeriod, Financials, Sourced


class ManualProvider:
    name = "manual"

    def __init__(self, root: Path):
        self.root = root

    def _csv_rows(self, filename: str) -> list[dict]:
        path = self.root / filename
        if not path.exists():
            return []
        with path.open(encoding="utf-8", newline="") as handle:
            return [row for row in csv.DictReader(handle) if any(v.strip() for v in row.values() if v)]

    def get_price_history(self, symbol: str) -> list[Sourced]:
        symbol = normalize_symbol(symbol)
        rows = [r for r in self._csv_rows("prices.csv") if normalize_symbol(r["symbol"]) == symbol]
        history = [Sourced(float(r["price"]), r["date"], r["source"]) for r in rows]
        return sorted(history, key=lambda s: s.as_of)

    def get_price(self, symbol: str) -> Sourced | None:
        history = self.get_price_history(symbol)
        return history[-1] if history else None

    def get_financials(self, symbol: str) -> Financials | None:
        symbol = normalize_symbol(symbol)
        path = self.root / "financials" / f"{symbol}.json"
        if not path.exists():
            return None
        raw = json.loads(path.read_text(encoding="utf-8"))
        periods = [
            FinancialPeriod(
                p["period"], p["period_end"], p["source"],
                {k: float(v) for k, v in p["data"].items() if v is not None},
            )
            for p in raw.get("periods", [])
        ]
        return Financials(symbol, raw.get("currency", "EGP"), raw.get("unit", "EGP"), periods)

    def get_macro(self) -> dict[str, Sourced]:
        path = self.root / "macro.json"
        if not path.exists():
            return {}
        raw = json.loads(path.read_text(encoding="utf-8"))
        return {
            key: Sourced(float(item["value"]), item["as_of"], item["source"])
            for key, item in raw.items()
            if isinstance(item, dict) and item.get("value") is not None
        }

    def get_events(self, symbol: str, since: str | None = None) -> list[Event]:
        symbol = normalize_symbol(symbol)
        events = [
            Event(normalize_symbol(r["symbol"]), r["date"], r["type"], r.get("description", ""), r.get("source", ""))
            for r in self._csv_rows("events.csv")
            if normalize_symbol(r["symbol"]) == symbol
        ]
        if since:
            events = [e for e in events if e.date > since]
        return sorted(events, key=lambda e: e.date)
