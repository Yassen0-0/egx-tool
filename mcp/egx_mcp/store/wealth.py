"""«تطوّر ثروتي» worked out from the ledger itself: the total of every day from the first purchase on,
and how a period moved in EGP, in dollars and in gold, with the money that came in kept apart.

- A day's total: each asset's quantity that day (store/movements.py) at that day's price
  (portfolio.price_on); an asset with no price known that early counts at its cost that day; a
  certificate from its terms. The last point is the ledger's own total, so the line ends where the
  screen's big number is.
- Debts (store/debts.py): what is left of each one that day is taken off the total.
- Money in: a purchase (its EGP cost) is money coming in, unless it is a return of another asset
  (a dividend, what a certificate paid) or a certificate bought with the ledger's own pounds; an expense money going out, and so is a
  debt when it starts (the borrowed pounds, if recorded, come in as a purchase); a transfer or a
  repayment moves money inside the ledger and is neither.
- A period's move: market = end − start − money in. Its percent is market over the start plus each
  inflow weighted by the part of the period it was there (modified Dietz). The same in dollars (each
  figure at its day's dollar rate) and in grams of 24 karat gold.
- Inflation: data/manual/inflation.csv (month,monthly_pct,source: CAPMAS urban headline, month on
  month). The real move needs every month of the period in the file; otherwise it is left out.

Numbers only: how the total moved, never what to do about it.
"""

import csv
import sqlite3
from bisect import bisect_right
from datetime import date, datetime, time, timedelta
from functools import lru_cache
from pathlib import Path

from ..catalog import DEPOSIT_PREFIX, catalog
from ..config import data_dir
from ..market.calendar import CAIRO, now_cairo
from . import debts, deposits, portfolio
from .movements import lot_day

DEFAULT_DAYS = 365
MAX_DAYS = 3650
DAILY_LIMIT = 400  # days before the last 400 are drawn one point a week
PERIODS = (("month", "شهر", 30), ("quarter", "3 شهور", 91), ("year", "سنة", 365), ("all", "من الأول", None))


# ── inflation ────────────────────────────────────────────────────────────────

def inflation_file() -> Path:
    return data_dir() / "manual" / "inflation.csv"


@lru_cache(maxsize=4)
def _inflation_at(path: str, mtime: float) -> dict[str, float]:
    with open(path, encoding="utf-8", newline="") as handle:
        return {r["month"].strip(): float(r["monthly_pct"]) / 100 for r in csv.DictReader(handle)
                if (r.get("month") or "").strip() and (r.get("monthly_pct") or "").strip()}


def monthly_inflation() -> dict[str, float]:
    path = inflation_file()
    try:
        return _inflation_at(str(path), path.stat().st_mtime)
    except FileNotFoundError:
        return {}


def _months_after(start: date, end: date) -> list[str]:
    """The months whose price change falls inside (start, end]: start's month is already in it."""
    out, y, m = [], start.year, start.month
    while (y, m) < (end.year, end.month):
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
        out.append(f"{y:04d}-{m:02d}")
    return out


def inflation_between(start: date, end: date) -> float | None:
    """Prices' rise from start to end, compounded month by month; None when a month is missing."""
    rates = monthly_inflation()
    months = _months_after(start, end)
    if not months or any(m not in rates for m in months):
        return None
    factor = 1.0
    for m in months:
        factor *= 1 + rates[m]
    return factor - 1


# ── the daily series ─────────────────────────────────────────────────────────

def _state_on(events: list[dict], dates: list[str], day: str) -> dict | None:
    i = bisect_right(dates, day)
    return events[i - 1] if i else None


def _days(start: date, end: date) -> list[date]:
    """Weekly up to the last DAILY_LIMIT days, then every day to `end`."""
    daily_from = end - timedelta(days=DAILY_LIMIT)
    out, d = [], start
    while d < daily_from:
        out.append(d)
        d += timedelta(days=7)
    d = daily_from if out else start
    while d <= end:
        out.append(d)
        d += timedelta(days=1)
    return out


def series(conn: sqlite3.Connection, at: datetime | None = None) -> list[dict]:
    """Every day of the last DAILY_LIMIT days (every week before them) from the first purchase to today: the total and
    cost in EGP, the money that came in since the previous point, and that day's dollar rate and
    gram of gold in EGP."""
    at = at or now_cairo()
    today = at.date()
    entries = {e["key"]: e for e in catalog(conn)}
    book = portfolio._book(conn, lambda key, quantity, day: portfolio.value_on(conn, entries.get(key), quantity, day),
                           today)
    tracks = {}
    for key, held in book["assets"].items():
        if key.startswith(DEPOSIT_PREFIX):
            continue  # a certificate is valued from its terms below
        events = held["events"]
        tracks[key] = (events, [e["date"] for e in events])
    certificates = [dict(r) for r in conn.execute("SELECT * FROM holdings WHERE kind = 'deposit' ORDER BY id")]
    terms = deposits.load(conn)
    owed = [(d, book["debts"].get(debts.key(d["id"]), [])) for d in debts.load(conn)]

    flows: dict[str, float] = {}
    for events, _ in tracks.values():
        for e in events:
            if e["type"] == "lot" and e["cost_egp"] is not None and not e.get("origin"):  # a return is not new money
                flows[e["date"]] = flows.get(e["date"], 0.0) + e["cost_egp"]
            elif e["type"] == "out" and e["kind"] == "expense" and e["value_egp"] is not None:
                flows[e["date"]] = flows.get(e["date"], 0.0) - e["value_egp"]
    bought = {key for key, held in book["assets"].items() if key.startswith(DEPOSIT_PREFIX)}
    for c in certificates:
        if c["symbol"] in bought:
            continue  # bought with the ledger's pounds: no new money
        day = lot_day(c)
        flows[day] = flows.get(day, 0.0) + c["cost_egp"]
    for d, _ in owed:
        flows[d["start_date"]] = flows.get(d["start_date"], 0.0) - d["principal"]

    starts = [d for events, dates in tracks.values() for d in dates[:1]] + list(flows)
    if not starts:
        return []
    first = date.fromisoformat(min(starts))
    unit_cache: dict[tuple[str, str], float | None] = {}

    def unit(key: str, day: str) -> float | None:
        if (key, day) not in unit_cache:
            unit_cache[key, day] = portfolio.value_on(conn, entries.get(key), 1.0, day)
        return unit_cache[key, day]

    points, previous = [], None
    for d in _days(min(first, today), today):
        day = d.isoformat()
        value = cost = 0.0
        for key, (events, dates) in tracks.items():
            state = _state_on(events, dates, day)
            if state is None or state["balance"] <= 0:
                continue
            price = unit(key, day)
            known_cost = state["cost_balance"]
            if price is not None:
                value += state["balance"] * price
            elif known_cost is not None:
                value += known_cost  # no price known that early: at its cost
            cost += known_cost or 0.0
        noon = datetime.combine(d, time(12), CAIRO)
        for c in certificates:
            if (lot_day(c)) <= day:
                value += deposits.valued(terms.get(c["id"]), c["quantity"], noon)["value"]
                cost += c["cost_egp"]
        value -= sum(debts.remaining_on(d, paid, day) for d, paid in owed)
        inflow = sum(v for k, v in flows.items() if (previous is None or k > previous) and k <= day)
        usd = portfolio.rate_on(conn, "USD", day)
        points.append({"date": day, "value_egp": value, "cost_egp": cost, "inflow_egp": inflow,
                       "usd_rate": usd["rate"] if usd else None, "gold_gram_egp": unit("XAU-G", day)})
        previous = day
    totals = portfolio.portfolio_summary(conn, at)["totals"]
    if totals["net_worth"] is not None:  # the line ends on the screen's own total
        points[-1]["value_egp"] = totals["net_worth"]
    return points


# ── a period ─────────────────────────────────────────────────────────────────

def _move(points: list[dict], unit_of) -> dict | None:
    """market, inflow and the modified-Dietz percent of the points, each figure divided by
    unit_of(point) (1 for EGP, the dollar rate, the gram of gold); None when a unit is missing."""
    units = [unit_of(p) for p in points]
    if any(u is None or u <= 0 for u in units):
        return None
    start, end = points[0], points[-1]
    v0, v1 = start["value_egp"] / units[0], end["value_egp"] / units[-1]
    t0, t1 = date.fromisoformat(start["date"]), date.fromisoformat(end["date"])
    span = (t1 - t0).days or 1
    inflow = weighted = 0.0
    for p, u in zip(points[1:], units[1:], strict=True):
        f = p["inflow_egp"] / u
        inflow += f
        weighted += f * (t1 - date.fromisoformat(p["date"])).days / span
    market = v1 - v0 - inflow
    base = v0 + weighted
    return {"start": v0, "end": v1, "inflow": inflow, "market": market, "pct": market / base if base > 0 else None}


def periods(points: list[dict]) -> list[dict]:
    """Each period that the series reaches back to: how it moved in EGP, dollars and gold, and
    against inflation when the file covers it."""
    if len(points) < 2:
        return []
    end = date.fromisoformat(points[-1]["date"])
    out = []
    for key, label, days in PERIODS:
        since = (end - timedelta(days=days)).isoformat() if days else points[0]["date"]
        if days and since < points[0]["date"]:
            continue
        window = [p for p in points if p["date"] >= since]
        if len(window) < 2:
            continue
        egp = _move(window, lambda p: 1.0)
        inflation = inflation_between(date.fromisoformat(window[0]["date"]), end)
        real = (1 + egp["pct"]) / (1 + inflation) - 1 if egp and egp["pct"] is not None and inflation is not None else None
        out.append({"period": key, "label": label, "from": window[0]["date"], "to": window[-1]["date"],
                    "egp": egp, "usd": _move(window, lambda p: p["usd_rate"]),
                    "gold_g": _move(window, lambda p: p["gold_gram_egp"]),
                    "inflation_pct": inflation, "real_pct": real})
    return out


def wealth_history(conn: sqlite3.Connection, days: int = DEFAULT_DAYS, at: datetime | None = None) -> dict:
    """The last `days` days of the series, oldest first, how the range moved (`change` in EGP,
    `change_pct` the market move without the money that came in, `inflow` that money) and the
    periods (month, 3 months, year, from the start) in EGP, dollars and gold."""
    try:
        days = int(days)
    except (TypeError, ValueError):
        days = DEFAULT_DAYS
    days = min(max(days, 1), MAX_DAYS)
    full = series(conn, at)
    if not full:
        return {"points": [], "first": None, "last": None, "change": None, "change_pct": None, "inflow": None,
                "periods": []}
    since = (date.fromisoformat(full[-1]["date"]) - timedelta(days=days)).isoformat()
    points = [p for p in full if p["date"] >= since]
    move = _move(points, lambda p: 1.0) if len(points) > 1 else None
    return {"points": [{"date": p["date"], "value_egp": p["value_egp"], "cost_egp": p["cost_egp"]} for p in points],
            "first": {"date": points[0]["date"], "value_egp": points[0]["value_egp"]},
            "last": {"date": points[-1]["date"], "value_egp": points[-1]["value_egp"]},
            "change": points[-1]["value_egp"] - points[0]["value_egp"],
            "change_pct": move["pct"] if move else None, "inflow": move["inflow"] if move else 0.0,
            "periods": periods(full)}

