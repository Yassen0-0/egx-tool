"""«السجل»: the assets the user types in, valued in EGP. The tool never checks them against a broker:
the user owns their accuracy.

A holding row is one purchase (a lot). The screen shows one row per asset (its lots summed), so
an asset's price, its fund components and its manual prices belong to the asset key, not to a lot.

- cost_egp = quantity × buy_price × fx_egp, fixed at purchase. fx_egp is EGP per unit of the buy
  currency on the buy day, or the rate implied by the EGP amount the user says they paid.
- value = quantity × the latest known price in EGP, however old (its date is shown); an asset with
  no price at all is left out of the total and of the growth, and counted.
- growth = (value − cost) / cost over the priced assets.
- today = the move of market prices that are fresh; manual prices never count as today's move.
- prices: EGX closes for stocks; EODHD feeds for currencies, gold and bitcoin (market/prices.py);
  the user's own price for anything else, or when it is newer than the market's.
- fund components are shown under the fund and never added to anything.
"""

import sqlite3
from datetime import date, datetime

from ..catalog import CURRENCY_CODES, GROUPS, catalog, custom_key, find
from ..errors import ValuationInputError
from ..market import store
from ..market.calendar import now_cairo
from ..market.prices import formula_price, formula_price_on, price_state
from .db import now_iso

DISCLAIMER = "الأرقام كما أدخلها المستخدم، والأسعار إغلاق متأخر أو سعر كتبه المستخدم. وصف للأرقام، وليس توصية بالشراء أو البيع."


def _positive(value: float | None, message: str) -> float:
    if value is None or not value > 0:
        raise ValuationInputError(message)
    return float(value)


def _day(value: str | None) -> str | None:
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(value[:10]).isoformat()
    except ValueError:
        raise ValuationInputError("التاريخ لازم يكون بالشكل سنة-شهر-يوم") from None


def _entry(conn: sqlite3.Connection, key: str) -> dict:
    entry = find(conn, key)
    if entry is None:
        raise ValuationInputError(f"الأصل {key} مش في الفهرس؛ أضفه بالاسم")
    return entry


# ── prices ───────────────────────────────────────────────────────────────────

def _manual_price(conn: sqlite3.Connection, key: str, on_or_before: str | None = None) -> dict | None:
    query, params = "SELECT * FROM manual_prices WHERE asset = ?", [key]
    if on_or_before:
        query += " AND date <= ?"
        params.append(on_or_before)
    row = conn.execute(query + " ORDER BY date DESC LIMIT 1", params).fetchone()
    return dict(row) if row else None


def resolve_price(conn: sqlite3.Connection, entry: dict, at: datetime) -> dict | None:
    """The asset's latest known unit price in its own currency: the market close (EGX stocks for
    now) or the user's manual price, whichever is newer; on the same day the market wins."""
    if entry["key"] == "EGP":
        return {"price": 1.0, "currency": "EGP", "as_of": None, "day": None, "source": "fixed", "stale": False,
                "change": None}
    market = None
    if entry["kind"] == "stock" and ":" not in entry["key"]:
        state = price_state(conn, entry["key"], at, store.last_bars(conn, entry["key"], 2))
        if state["price"] is not None:
            market = {"price": state["price"], "currency": entry["currency"], "as_of": state["as_of"],
                      "day": state["as_of_day"], "source": "EODHD", "stale": state["stale"], "change": state["change"]}
    else:
        market = formula_price(conn, entry["key"], at)
    row = _manual_price(conn, entry["key"])
    manual = None if row is None else {
        "price": row["price"], "currency": row["currency"], "as_of": row["date"], "day": row["date"],
        "source": "manual", "stale": row["date"] < at.date().isoformat(), "change": None}
    if market and manual:
        return manual if manual["day"] > market["day"] else market
    return market or manual


def rate_now(conn: sqlite3.Connection, currency: str, at: datetime) -> dict | None:
    """EGP per unit of `currency` from its asset's latest price (EGP itself is 1)."""
    if currency == "EGP":
        return {"rate": 1.0, "previous": 1.0, "as_of": None}
    entry = find(conn, currency)
    price = resolve_price(conn, entry, at) if entry else None
    if price is None or price["currency"] != "EGP":
        return None
    previous = price["price"] - price["change"] if price.get("change") is not None else price["price"]
    return {"rate": price["price"], "previous": previous, "as_of": price["as_of"]}


def rate_on(conn: sqlite3.Connection, currency: str, day: str) -> dict | None:
    """EGP per unit of `currency` on `day`: the newer of the market's rate (stored bars up to a week
    before it) and the user's own price on or before it. None when nothing is known that early."""
    if currency == "EGP":
        return {"rate": 1.0, "as_of": day}
    found = []
    market = formula_price_on(conn, currency, day)
    if market and market["currency"] == "EGP":
        found.append((market["as_of"], 1, market["price"]))
    row = _manual_price(conn, currency, day)
    if row is not None and row["currency"] == "EGP":
        found.append((row["date"], 0, row["price"]))
    if not found:
        return None
    as_of, _, rate = max(found)
    return {"rate": rate, "as_of": as_of}


def fx_rate(conn: sqlite3.Connection, currency: str, day: str | None = None) -> dict:
    """What the add form shows: the EGP rate it would use for a purchase in `currency` on `day`."""
    currency = currency.strip().upper()
    if currency not in CURRENCY_CODES:
        raise ValuationInputError(f"عملة غير معروفة: {currency}")
    day = _day(day) or now_cairo().date().isoformat()
    found = rate_on(conn, currency, day)
    return {"currency": currency, "date": day, "rate": found["rate"] if found else None,
            "as_of": found["as_of"] if found else None}


def set_price(conn: sqlite3.Connection, asset: str, price: float, currency: str | None = None,
              day: str | None = None) -> dict:
    """The user's price for an asset on a day (default today); a newer market close wins over it."""
    entry = _entry(conn, asset)
    if entry["key"] == "EGP":
        raise ValuationInputError("الجنيه سعره ثابت")
    price = _positive(price, "السعر لازم يكون أكبر من صفر")
    currency = (currency or entry["currency"]).strip().upper()
    if currency not in CURRENCY_CODES:
        raise ValuationInputError(f"عملة غير معروفة: {currency}")
    if entry["kind"] == "currency" and currency != "EGP":
        raise ValuationInputError("سعر العملة بيتكتب بالجنيه")
    if currency == entry["key"]:
        raise ValuationInputError("سعر الأصل ما ينفعش يكون بنفس عملته")
    day = _day(day) or now_cairo().date().isoformat()
    conn.execute(
        "INSERT INTO manual_prices (asset, date, price, currency, created_at) VALUES (?, ?, ?, ?, ?)"
        " ON CONFLICT(asset, date) DO UPDATE SET price = excluded.price, currency = excluded.currency,"
        " created_at = excluded.created_at",
        (entry["key"], day, price, currency, now_iso()),
    )
    conn.commit()
    return {"asset": entry["key"], "date": day, "price": price, "currency": currency}


def priced_catalog(conn: sqlite3.Connection, at: datetime | None = None) -> list[dict]:
    """The catalog with each asset's latest known unit price (in its own currency and in EGP), so the
    add line can show it beside the price field and question a price typed in the wrong unit."""
    at = at or now_cairo()
    out = []
    for entry in catalog(conn):
        price = resolve_price(conn, entry, at)
        rate = rate_now(conn, price["currency"], at) if price else None
        out.append({**entry, "price": price["price"] if price else None,
                    "price_currency": price["currency"] if price else None,
                    "price_egp": price["price"] * rate["rate"] if price and rate else None,
                    "price_as_of": price["as_of"] if price else None})
    return out


# ── holdings ─────────────────────────────────────────────────────────────────

def _custom_asset(conn: sqlite3.Connection, custom: dict) -> dict:
    kind = custom.get("kind")
    if kind not in ("currency", "gold", "bitcoin", "stock", "fund"):
        raise ValuationInputError("اختار نوع الأصل")
    name = (custom.get("name") or "").strip()
    if not name:
        raise ValuationInputError("اكتب اسم الأصل")
    symbol = (custom.get("symbol") or "").strip().upper() or None
    currency = (custom.get("currency") or "EGP").strip().upper()
    if currency not in CURRENCY_CODES:
        raise ValuationInputError(f"عملة غير معروفة: {currency}")
    row = conn.execute("SELECT id FROM custom_assets WHERE kind = ? AND lower(name) = lower(?)", (kind, name)).fetchone()
    if row is None:
        row_id = conn.execute(
            "INSERT INTO custom_assets (kind, name, symbol, currency, created_at) VALUES (?, ?, ?, ?, ?)",
            (kind, name, symbol, currency, now_iso())).lastrowid
    else:
        row_id = row["id"]
    return find(conn, custom_key(row_id))


def add_holding(
    conn: sqlite3.Connection,
    asset: str | None = None,
    buy_price: float | None = None,
    quantity: float | None = None,
    amount: float | None = None,
    currency: str | None = None,
    cost_egp: float | None = None,
    buy_date: str | None = None,
    note: str | None = None,
    custom: dict | None = None,
) -> dict:
    """Add one purchase: an asset from the catalog (or a new one by name in `custom`), the quantity
    or the amount paid, the unit price in `currency`, and optionally the EGP the user actually paid."""
    if (asset is None) == (custom is None):
        raise ValuationInputError("اختار أصل من البحث أو أضفه بالاسم")
    try:
        return _add_holding(conn, asset, buy_price, quantity, amount, currency, cost_egp, buy_date, note, custom)
    except Exception:
        conn.rollback()  # an asset added by name stays only with a valid purchase
        raise


def _add_holding(conn, asset, buy_price, quantity, amount, currency, cost_egp, buy_date, note, custom) -> dict:
    entry = _custom_asset(conn, custom) if custom is not None else _entry(conn, asset)
    if entry["key"] == "EGP":
        buy_price, currency = 1.0, "EGP"
    currency = (currency or entry["currency"]).strip().upper()
    if entry["kind"] == "currency":
        currency = "EGP"  # a currency's price is what one unit cost in EGP
    if currency not in CURRENCY_CODES:
        raise ValuationInputError(f"عملة غير معروفة: {currency}")
    buy_price = _positive(buy_price, "سعر الشرا لازم يكون أكبر من صفر")
    if (quantity in (None, "")) == (amount in (None, "")):
        raise ValuationInputError("اكتب الكمية أو المبلغ، واحد منهم بس")
    quantity = _positive(quantity, "الكمية لازم تكون أكبر من صفر") if quantity not in (None, "") \
        else _positive(amount, "المبلغ لازم يكون أكبر من صفر") / buy_price
    buy_date = _day(buy_date)
    paid = quantity * buy_price
    if currency == "EGP":
        fx = 1.0
    elif cost_egp not in (None, ""):
        fx = _positive(cost_egp, "المبلغ بالجنيه لازم يكون أكبر من صفر") / paid
    else:
        found = rate_on(conn, currency, buy_date or now_cairo().date().isoformat())
        if found is None:
            raise ValuationInputError(f"مفيش سعر {currency} معروف في اليوم ده؛ اكتب المبلغ اللي دفعته بالجنيه")
        fx = found["rate"]
    stamp = now_iso()
    cursor = conn.execute(
        "INSERT INTO holdings (symbol, quantity, buy_price, buy_date, note, created_at, updated_at, kind, name,"
        " currency, fx_egp, cost_egp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (entry["key"], quantity, buy_price, buy_date, (note or "").strip() or None, stamp, stamp, entry["kind"],
         entry["name"], currency, fx, paid * fx),
    )
    if custom is not None and custom.get("price") not in (None, ""):
        set_price(conn, entry["key"], custom["price"], custom.get("currency") or entry["currency"])  # commits
    conn.commit()
    return get_holding(conn, cursor.lastrowid)


def get_holding(conn: sqlite3.Connection, holding_id: int) -> dict:
    row = conn.execute("SELECT * FROM holdings WHERE id = ?", (holding_id,)).fetchone()
    if row is None:
        raise ValuationInputError(f"العملية {holding_id} مش موجودة")
    return dict(row)


def update_holding(
    conn: sqlite3.Connection,
    holding_id: int,
    quantity: float | None = None,
    buy_price: float | None = None,
    buy_date: str | None = None,
    note: str | None = None,
    cost_egp: float | None = None,
) -> dict:
    """Edit a purchase. The cost is recomputed with the rate saved at purchase, not today's; an EGP
    amount (for a purchase in another currency) sets a new implied rate instead."""
    current = get_holding(conn, holding_id)
    quantity = current["quantity"] if quantity in (None, "") else _positive(quantity, "الكمية لازم تكون أكبر من صفر")
    buy_price = current["buy_price"] if buy_price in (None, "") else _positive(buy_price, "سعر الشرا لازم يكون أكبر من صفر")
    if current["symbol"] == "EGP":
        buy_price = 1.0
    fx = current["fx_egp"] or None  # 0: the rate of an old dollar purchase is not known yet
    if cost_egp not in (None, "") and current["currency"] != "EGP":
        fx = _positive(cost_egp, "المبلغ بالجنيه لازم يكون أكبر من صفر") / (quantity * buy_price)
    conn.execute(
        "UPDATE holdings SET quantity = ?, buy_price = ?, buy_date = ?, note = ?, fx_egp = ?, cost_egp = ?,"
        " updated_at = ? WHERE id = ?",
        (quantity, buy_price, current["buy_date"] if buy_date in (None, "") else _day(buy_date),
         current["note"] if note is None else (note.strip() or None), fx or 0,
         None if fx is None else quantity * buy_price * fx,
         now_iso(), holding_id),
    )
    conn.commit()
    return get_holding(conn, holding_id)


def remove_holding(conn: sqlite3.Connection, holding_id: int) -> dict:
    holding = get_holding(conn, holding_id)
    conn.execute("DELETE FROM holdings WHERE id = ?", (holding_id,))
    conn.commit()
    return {"removed": holding}


def remove_asset(conn: sqlite3.Connection, asset: str) -> dict:
    """Every purchase of an asset, and a fund's components with it. Its manual prices stay."""
    rows = [dict(r) for r in conn.execute("SELECT * FROM holdings WHERE symbol = ?", (asset,))]
    if not rows:
        raise ValuationInputError(f"مفيش عمليات للأصل {asset}")
    conn.execute("DELETE FROM holdings WHERE symbol = ?", (asset,))
    conn.execute("DELETE FROM fund_components WHERE fund = ?", (asset,))
    conn.commit()
    return {"removed": rows}


def set_fund_components(conn: sqlite3.Connection, fund: str, components: list[dict]) -> dict:
    """Replace what a fund holds: stocks with their weight (0–1). Display only, never summed."""
    entry = _entry(conn, fund)
    if entry["kind"] != "fund":
        raise ValuationInputError("المكونات للصناديق بس")
    rows, seen = [], set()
    for c in components:
        part = _entry(conn, str(c.get("asset") or ""))
        if part["kind"] != "stock":
            raise ValuationInputError("مكون الصندوق لازم يكون سهم")
        weight = _positive(c.get("weight"), "نسبة المكون لازم تكون أكبر من صفر")
        if weight > 1 or part["key"] in seen:
            raise ValuationInputError("كل مكون مرة واحدة، ونسبته 100% أو أقل")
        seen.add(part["key"])
        rows.append((entry["key"], part["key"], weight, now_iso()))
    if sum(r[2] for r in rows) > 1 + 1e-9:
        raise ValuationInputError("مجموع نسب المكونات أكبر من 100%")
    conn.execute("DELETE FROM fund_components WHERE fund = ?", (entry["key"],))
    conn.executemany("INSERT INTO fund_components (fund, asset, weight, updated_at) VALUES (?, ?, ?, ?)", rows)
    conn.commit()
    return {"fund": entry["key"], "components": fund_components(conn, entry["key"])}


def fund_components(conn: sqlite3.Connection, fund: str) -> list[dict]:
    out = []
    for r in conn.execute("SELECT asset, weight FROM fund_components WHERE fund = ? ORDER BY weight DESC, asset",
                          (fund,)):
        part = find(conn, r["asset"]) or {"name": r["asset"], "symbol": r["asset"], "mark": r["asset"][:2]}
        out.append({"asset": r["asset"], "name": part["name"], "symbol": part.get("symbol"), "mark": part["mark"],
                    "weight": r["weight"]})
    return out


# ── the ledger ───────────────────────────────────────────────────────────────

def _lot(row: dict) -> dict:
    keys = ("id", "quantity", "buy_price", "currency", "fx_egp", "cost_egp", "buy_date", "note", "created_at",
            "updated_at")
    return {k: row[k] for k in keys}


def portfolio_summary(conn: sqlite3.Connection, at: datetime | None = None) -> dict:
    """The ledger: totals in EGP, then the assets in four groups (currencies with gold, bitcoin,
    stocks, funds), each asset with its lots and, for a fund, its components."""
    at = at or now_cairo()
    entries = {e["key"]: e for e in catalog(conn)}
    lots: dict[str, list[dict]] = {}
    for row in conn.execute("SELECT * FROM holdings ORDER BY id"):
        lots.setdefault(row["symbol"], []).append(dict(row))

    assets = []
    for key, rows in lots.items():
        entry = entries.get(key) or {"key": key, "kind": rows[0]["kind"], "group": "stocks", "name": rows[0]["name"] or key,
                                     "symbol": key, "mark": key[:2], "unit": "", "currency": rows[0]["currency"],
                                     "kind_label": ""}
        quantity = sum(r["quantity"] for r in rows)
        # A purchase whose EGP cost is unknown (an old dollar line) makes the asset's cost unknown.
        cost = None if any(r["cost_egp"] is None for r in rows) else sum(r["cost_egp"] for r in rows)
        price = resolve_price(conn, entry, at)
        rate = rate_now(conn, price["currency"], at) if price else None
        unit_egp = price["price"] * rate["rate"] if price and rate else None
        value = quantity * unit_egp if unit_egp is not None else None
        fresh = bool(price and price["source"] == "EODHD" and price["stale"] is False and price["change"] is not None)
        # The day's move in EGP, the dollar's own move included for a price in dollars.
        today = quantity * (price["price"] * rate["rate"] - (price["price"] - price["change"]) * rate["previous"]) \
            if fresh and rate else None
        assets.append({
            "key": key, "kind": entry["kind"], "kind_label": entry["kind_label"], "group": entry["group"],
            "name": entry["name"], "symbol": entry.get("symbol"), "mark": entry["mark"], "unit": entry["unit"],
            "quantity": quantity, "cost_egp": cost, "value_egp": value,
            "growth": value / cost - 1 if value is not None and cost else None,  # None cost: unknown
            "price": price["price"] if price else None, "price_currency": price["currency"] if price else entry["currency"],
            "price_egp": unit_egp, "price_as_of": price["as_of"] if price else None,
            "price_source": price["source"] if price else None, "stale": price["stale"] if price else None,
            "today_change": today, "today_as_of": price["day"] if fresh else None,
            "lots": [_lot(r) for r in rows],
            "components": fund_components(conn, key) if entry["kind"] == "fund" else [],
        })

    priced = [a for a in assets if a["value_egp"] is not None]
    value = sum(a["value_egp"] for a in priced)
    costed = [a for a in priced if a["cost_egp"] is not None]  # growth needs both ends
    priced_cost = sum(a["cost_egp"] for a in costed)
    costed_value = sum(a["value_egp"] for a in costed)
    moved = [a for a in assets if a["today_change"] is not None]
    today = sum(a["today_change"] for a in moved)
    today_base = sum(a["value_egp"] for a in moved) - today
    unpriced = [a["name"] for a in assets if a["value_egp"] is None]

    groups = []
    for group, label in GROUPS:
        members = [a for a in assets if a["group"] == group]
        if members:
            members.sort(key=lambda a: (a["value_egp"] is None, -(a["value_egp"] or 0), a["name"]))
            groups.append({"group": group, "label": label, "assets": members})
    return {
        "as_of": at.isoformat(timespec="minutes"),
        "totals": {
            "assets": len(assets),
            "value": value if priced else None,
            "cost": sum(a["cost_egp"] for a in assets if a["cost_egp"] is not None),
            "priced_cost": priced_cost,
            "growth": costed_value / priced_cost - 1 if costed and priced_cost else None,
            "unpriced": unpriced,
            "today_change": today if moved else None,
            "today_change_pct": today / today_base if moved and today_base else None,
            "today_has_fresh": bool(moved),
            "today_as_of": max(a["today_as_of"] for a in moved) if moved else None,
        },
        "groups": groups,
        "disclaimer": DISCLAIMER,
    }


def record_snapshot(conn: sqlite3.Connection, at: datetime | None = None) -> dict | None:
    """Today's total and cost (priced assets), one row per Cairo day, the latest run wins. Not shown
    yet: it lets a «how my wealth moved» line exist later, which the user's own prices could never
    be rebuilt for."""
    at = at or now_cairo()
    totals = portfolio_summary(conn, at)["totals"]
    if totals["value"] is None:
        return None
    row = (at.date().isoformat(), totals["value"], totals["priced_cost"], totals["assets"], now_iso())
    conn.execute(
        "INSERT INTO ledger_snapshots (date, value_egp, cost_egp, assets, recorded_at) VALUES (?, ?, ?, ?, ?)"
        " ON CONFLICT(date) DO UPDATE SET value_egp = excluded.value_egp, cost_egp = excluded.cost_egp,"
        " assets = excluded.assets, recorded_at = excluded.recorded_at", row)
    conn.commit()
    return dict(zip(("date", "value_egp", "cost_egp", "assets", "recorded_at"), row, strict=True))
