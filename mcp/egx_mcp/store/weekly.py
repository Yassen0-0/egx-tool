"""Decides whether the weekly run is a light update or needs a full revaluation."""

import sqlite3

from ..data.provider import DataProvider
from ..pricing import pricing_levels
from ..universe import normalize_symbol
from .valuations import latest_valuation

RISK_FREE_SHIFT = 0.01  # one percentage point
FX_SHIFT = 0.05  # five percent move in USD/EGP
MATERIAL_EVENT_TYPES = {
    "earnings", "capital_increase", "acquisition", "disposal", "merger", "rating_change",
    "regulatory", "litigation", "dividend_change", "major_contract", "management_change",
}


def weekly_check(conn: sqlite3.Connection, provider: DataProvider, symbol: str) -> dict:
    symbol = normalize_symbol(symbol)
    valuation = latest_valuation(conn, symbol, kind="full")
    price = provider.get_price(symbol)
    if valuation is None:
        return {"symbol": symbol, "needs_full_revaluation": True, "reasons": ["no full valuation exists yet"],
                "current_price": price.to_dict() if price else None}

    reasons: list[str] = []

    financials = provider.get_financials(symbol)
    latest_period = financials.latest if financials else None
    if latest_period and latest_period.period != valuation["financial_period"]:
        reasons.append(f"new financial period {latest_period.period} (valued on {valuation['financial_period']})")

    snapshot = valuation.get("macro_snapshot") or {}
    macro = provider.get_macro()
    rf_then = (snapshot.get("risk_free_rate_egp") or {}).get("value")
    rf_now = macro.get("risk_free_rate_egp")
    if rf_then is not None and rf_now is not None and abs(rf_now.value - rf_then) >= RISK_FREE_SHIFT:
        reasons.append(f"EGP risk-free rate moved from {rf_then:.2%} to {rf_now.value:.2%}")
    fx_then = (snapshot.get("usd_egp") or {}).get("value")
    fx_now = macro.get("usd_egp")
    if fx_then and fx_now is not None and abs(fx_now.value / fx_then - 1) >= FX_SHIFT:
        reasons.append(f"USD/EGP moved from {fx_then:.2f} to {fx_now.value:.2f}")

    events = provider.get_events(symbol, since=valuation["created_at"][:10])
    material = [e for e in events if e.type in MATERIAL_EVENT_TYPES]
    for e in material:
        reasons.append(f"material event {e.type} on {e.date}: {e.description}")

    levels = pricing_levels(valuation["fair_value"], price.value if price else None)
    if levels.get("review_required"):
        reasons.append("price is below the protection price: critic review required")

    return {
        "symbol": symbol,
        "needs_full_revaluation": bool(reasons),
        "reasons": reasons,
        "last_full_valuation": {"id": valuation["id"], "created_at": valuation["created_at"],
                                "fair_value": valuation["fair_value"], "financial_period": valuation["financial_period"]},
        "current_price": price.to_dict() if price else None,
        "pricing": levels,
        "non_material_events": [e.__dict__ for e in events if e.type not in MATERIAL_EVENT_TYPES],
    }
