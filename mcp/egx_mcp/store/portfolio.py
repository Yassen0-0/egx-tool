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
- a bank certificate or deposit is not priced: store/deposits.py values it from its terms.
- movements (store/movements.py) take quantities out of an asset, into another or out of the ledger;
  an asset's quantity and cost are what `movements.replay` leaves of its purchases. A change that
  would take more than an asset held on some day is refused.
"""

import sqlite3
from datetime import date, datetime, timedelta

from ..catalog import (
    CURRENCY_CODES,
    DEPOSIT_PREFIX,
    GROUPS,
    catalog,
    custom_key,
    deposit_entry,
    egx_ticker,
    find,
    match,
)
from ..errors import LedgerInputError
from ..market import store
from ..market.calendar import now_cairo
from ..market.prices import close_on, formula_price, formula_price_on, price_state
from . import debts, deposits, movements
from .db import now_iso

DISCLAIMER = "الأرقام كما أدخلها المستخدم، والأسعار إغلاق متأخر أو سعر كتبه المستخدم. وصف للأرقام، وليس توصية بالشراء أو البيع."


def _positive(value: float | None, message: str) -> float:
    if value is None or not value > 0:
        raise LedgerInputError(message)
    return float(value)


def _day(value: str | None) -> str | None:
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(value[:10]).isoformat()
    except ValueError:
        raise LedgerInputError("التاريخ لازم يكون بالشكل سنة-شهر-يوم") from None


def _entry(conn: sqlite3.Connection, key: str) -> dict:
    entry = find(conn, key)
    if entry is None:
        raise LedgerInputError(f"الأصل {key} مش في الفهرس؛ أضفه بالاسم")
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
    ticker = egx_ticker(entry["key"], entry["kind"], entry.get("symbol"))
    if ticker:
        state = price_state(conn, ticker, at, store.last_bars(conn, ticker, 2))
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


def price_on(conn: sqlite3.Connection, entry: dict, day: str) -> dict | None:
    """The asset's unit price on `day` in its own currency: the newer of the market's (an EGX close,
    or the feeds' bars up to a week before it) and the user's own price on or before it; on the same
    day the market wins. None when nothing is known that early."""
    if entry["key"] == "EGP":
        return {"price": 1.0, "currency": "EGP", "as_of": day}
    found = []
    ticker = egx_ticker(entry["key"], entry["kind"], entry.get("symbol"))
    if ticker:
        close = close_on(conn, ticker, day)
        if close:
            found.append((close[1], 1, close[0], entry["currency"]))
    else:
        market = formula_price_on(conn, entry["key"], day)
        if market:
            found.append((market["as_of"], 1, market["price"], market["currency"]))
    row = _manual_price(conn, entry["key"], day)
    if row is not None:
        found.append((row["date"], 0, row["price"], row["currency"]))
    if not found:
        return None
    as_of, _, price, currency = max(found)
    return {"price": price, "currency": currency, "as_of": as_of}


def rate_on(conn: sqlite3.Connection, currency: str, day: str) -> dict | None:
    """EGP per unit of `currency` on `day` (price_on of the currency). None when nothing is known that early."""
    if currency == "EGP":
        return {"rate": 1.0, "as_of": day}
    entry = find(conn, currency)
    found = price_on(conn, entry, day) if entry else None
    if found is None or found["currency"] != "EGP":
        return None
    return {"rate": found["price"], "as_of": found["as_of"]}


def value_on(conn: sqlite3.Connection, entry: dict | None, quantity: float, day: str) -> float | None:
    """What `quantity` of the asset was worth in EGP on `day`, at the prices known for that day."""
    if entry is None or entry["kind"] == "deposit":
        return None
    price = price_on(conn, entry, day)
    rate = rate_on(conn, price["currency"], day) if price else None
    return quantity * price["price"] * rate["rate"] if price and rate else None


def fx_rate(conn: sqlite3.Connection, currency: str, day: str | None = None) -> dict:
    """What the add form shows: the EGP rate it would use for a purchase in `currency` on `day`."""
    currency = currency.strip().upper()
    if currency not in CURRENCY_CODES:
        raise LedgerInputError(f"عملة غير معروفة: {currency}")
    day = _day(day) or now_cairo().date().isoformat()
    found = rate_on(conn, currency, day)
    return {"currency": currency, "date": day, "rate": found["rate"] if found else None,
            "as_of": found["as_of"] if found else None}


def set_price(conn: sqlite3.Connection, asset: str, price: float, currency: str | None = None,
              day: str | None = None) -> dict:
    """The user's price for an asset on a day (default today); a newer market close wins over it."""
    if asset.startswith(DEPOSIT_PREFIX):
        raise LedgerInputError("الشهادة والوديعة قيمتها بتتحسب من شروطها، مفيش سعر تكتبه")
    entry = _entry(conn, asset)
    if entry["key"] == "EGP":
        raise LedgerInputError("الجنيه سعره ثابت")
    price = _positive(price, "السعر لازم يكون أكبر من صفر")
    currency = (currency or entry["currency"]).strip().upper()
    if currency not in CURRENCY_CODES:
        raise LedgerInputError(f"عملة غير معروفة: {currency}")
    if entry["kind"] == "currency" and currency != "EGP":
        raise LedgerInputError("سعر العملة بيتكتب بالجنيه")
    if currency == entry["key"]:
        raise LedgerInputError("سعر الأصل ما ينفعش يكون بنفس عملته")
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
    # Something the catalog already has, whatever kind it was given («SPY» as a stock is the fund).
    known = match(custom.get("name"), custom.get("symbol"))
    if known is not None:
        return dict(known)
    kind = custom.get("kind")
    if kind not in ("currency", "gold", "bitcoin", "stock", "fund"):
        raise LedgerInputError("اختار نوع الأصل")
    name = (custom.get("name") or "").strip()
    if not name:
        raise LedgerInputError("اكتب اسم الأصل")
    symbol = (custom.get("symbol") or "").strip().upper() or None
    currency = (custom.get("currency") or "EGP").strip().upper()
    if currency not in CURRENCY_CODES:
        raise LedgerInputError(f"عملة غير معروفة: {currency}")
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
    deposit: dict | None = None,
    place: str | None = None,
) -> dict:
    """Add one purchase: an asset from the catalog (or a new one by name in `custom`), the quantity
    or the amount paid, the unit price in `currency`, optionally the EGP the user actually paid and
    where the asset is (`place`). A bank certificate or deposit is `deposit` alone, with its
    principal as the amount."""
    if deposit is not None:
        return _add_deposit(conn, asset, quantity, amount, currency, note, custom, deposit)
    if (asset is None) == (custom is None):
        raise LedgerInputError("اختار أصل من البحث أو أضفه بالاسم")
    try:
        return _add_holding(conn, asset, buy_price, quantity, amount, currency, cost_egp, buy_date, note, custom,
                            place=place)
    except Exception:
        conn.rollback()  # an asset added by name stays only with a valid purchase
        raise


def _add_deposit(conn, asset, quantity, amount, currency, note, custom, deposit) -> dict:
    if asset is not None or custom is not None:
        raise LedgerInputError("الشهادة أو الوديعة بتتضاف لوحدها، من غير أصل من البحث")
    if (currency or "EGP").strip().upper() != "EGP":
        raise LedgerInputError("الشهادة والوديعة بالجنيه المصري بس")
    if (quantity in (None, "")) == (amount in (None, "")):
        raise LedgerInputError("اكتب مبلغ الشهادة، مرة واحدة")
    principal = _positive(amount if quantity in (None, "") else quantity, "مبلغ الشهادة لازم يكون أكبر من صفر")
    before = _shortfalls(conn)
    try:
        holding_id = deposits.add(conn, principal, note, deposit, settle_to_egp=deposit.get("settle_to_egp", True))
        if deposit.get("from_egp"):
            # Bought with the ledger's pounds: they move into the certificate on its start day.
            row = get_holding(conn, holding_id)
            stamp = now_iso()
            conn.execute(
                "INSERT INTO movements (date, kind, from_asset, from_quantity, to_asset, to_quantity, note, created_at,"
                " updated_at, from_place) VALUES (?, 'transfer', 'EGP', ?, ?, ?, ?, ?, ?, ?)",
                (row["buy_date"], principal, row["symbol"], principal, f"شرا {row['name']}", stamp, stamp,
                 _place(deposit.get("from_place"))))
    except Exception:
        conn.rollback()
        raise
    _commit_unless_short(conn, before, "سجّل الجنيه اللي اشتريت بيه الشهادة الأول، أو شيل «من الجنيه اللي في السجل».")
    return get_holding(conn, holding_id)


def _place(value: str | None) -> str | None:
    """A place as typed («البنك الأهلي», «Thndr»), trimmed; blank is none."""
    text = str(value or "").strip()
    if len(text) > 40:
        raise LedgerInputError("اسم المكان أطول من اللازم")
    return text or None


def _add_holding(conn, asset, buy_price, quantity, amount, currency, cost_egp, buy_date, note, custom,
                 commit=True, place=None) -> dict:
    entry = _custom_asset(conn, custom) if custom is not None else _entry(conn, asset)
    if custom is not None and not entry["key"].startswith("custom:"):
        currency = currency or custom.get("currency")  # the price was typed in the currency given
    if entry["key"] == "EGP":
        buy_price, currency = 1.0, "EGP"
    currency = (currency or entry["currency"]).strip().upper()
    if entry["kind"] == "currency":
        currency = "EGP"  # a currency's price is what one unit cost in EGP
    if currency not in CURRENCY_CODES:
        raise LedgerInputError(f"عملة غير معروفة: {currency}")
    buy_price = _positive(buy_price, "سعر الشرا لازم يكون أكبر من صفر")
    if (quantity in (None, "")) == (amount in (None, "")):
        raise LedgerInputError("اكتب الكمية أو المبلغ، واحد منهم بس")
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
            raise LedgerInputError(f"مفيش سعر {currency} معروف في اليوم ده؛ اكتب المبلغ اللي دفعته بالجنيه")
        fx = found["rate"]
    stamp = now_iso()
    cursor = conn.execute(
        "INSERT INTO holdings (symbol, quantity, buy_price, buy_date, note, created_at, updated_at, kind, name,"
        " currency, fx_egp, cost_egp, place) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (entry["key"], quantity, buy_price, buy_date, (note or "").strip() or None, stamp, stamp, entry["kind"],
         entry["name"], currency, fx, paid * fx, _place(place)),
    )
    if custom is not None and custom.get("price") not in (None, ""):
        set_price(conn, entry["key"], custom["price"], custom.get("currency") or entry["currency"])  # commits
    if commit:
        conn.commit()
    return get_holding(conn, cursor.lastrowid)


def get_holding(conn: sqlite3.Connection, holding_id: int) -> dict:
    row = conn.execute("SELECT * FROM holdings WHERE id = ?", (holding_id,)).fetchone()
    if row is None:
        raise LedgerInputError(f"العملية {holding_id} مش موجودة")
    return dict(row)


def update_holding(
    conn: sqlite3.Connection,
    holding_id: int,
    quantity: float | None = None,
    buy_price: float | None = None,
    buy_date: str | None = None,
    note: str | None = None,
    cost_egp: float | None = None,
    deposit: dict | None = None,
    place: str | None = None,
) -> dict:
    """Edit a purchase (`place` None keeps it, blank clears it). The cost is recomputed with the rate saved at purchase, not today's; an EGP
    amount (for a purchase in another currency) sets a new implied rate instead. A certificate's
    terms change with `deposit` (some of rate, start_date, maturity_date, payout, bank), and its date
    is its start date."""
    current = get_holding(conn, holding_id)
    before = _shortfalls(conn)
    if deposit is not None and current["kind"] != "deposit":
        raise LedgerInputError("الشروط للشهادات والودائع بس")
    quantity = current["quantity"] if quantity in (None, "") else _positive(quantity, "الكمية لازم تكون أكبر من صفر")
    buy_price = current["buy_price"] if buy_price in (None, "") else _positive(buy_price, "سعر الشرا لازم يكون أكبر من صفر")
    if current["symbol"] == "EGP" or current["kind"] == "deposit":
        buy_price = 1.0
    fx = current["fx_egp"] or None  # 0: the rate of an old dollar purchase is not known yet
    if cost_egp not in (None, "") and current["currency"] != "EGP":
        fx = _positive(cost_egp, "المبلغ بالجنيه لازم يكون أكبر من صفر") / (quantity * buy_price)
    if current["kind"] == "deposit":
        changes = dict(deposit or {})
        if buy_date not in (None, "") and "start_date" not in changes:
            changes["start_date"] = _day(buy_date)
        if changes:
            buy_date = deposits.update(conn, holding_id, changes)["start_date"]
    conn.execute(
        "UPDATE holdings SET quantity = ?, buy_price = ?, buy_date = ?, note = ?, fx_egp = ?, cost_egp = ?,"
        " place = ?, updated_at = ? WHERE id = ?",
        (quantity, buy_price, current["buy_date"] if buy_date in (None, "") else _day(buy_date),
         current["note"] if note is None else (note.strip() or None), fx or 0,
         None if fx is None else quantity * buy_price * fx,
         current["place"] if place is None else _place(place), now_iso(), holding_id),
    )
    _commit_unless_short(conn, before)
    return get_holding(conn, holding_id)


def remove_holding(conn: sqlite3.Connection, holding_id: int) -> dict:
    holding = get_holding(conn, holding_id)
    if holding["kind"] == "deposit" and conn.execute(
            "SELECT 1 FROM movements WHERE to_asset = ? LIMIT 1", (holding["symbol"],)).fetchone():
        raise LedgerInputError("الشهادة دي اتشرت بجنيه من السجل: احذف تحويل الشرا من حركات الجنيه الأول")
    before = _shortfalls(conn)
    conn.execute("DELETE FROM holdings WHERE id = ?", (holding_id,))
    _commit_unless_short(conn, before)
    return {"removed": holding}


def remove_asset(conn: sqlite3.Connection, asset: str) -> dict:
    """Every purchase of an asset, and a fund's components with it. Its manual prices stay. An asset
    that money moved into or out of keeps its movements: they are removed first, one by one."""
    rows = [dict(r) for r in conn.execute("SELECT * FROM holdings WHERE symbol = ?", (asset,))]
    if conn.execute("SELECT 1 FROM movements WHERE from_asset = ? OR to_asset = ? LIMIT 1", (asset, asset)).fetchone():
        raise LedgerInputError("الأصل ده داخل في تحويلات: احذفها من حركاته الأول، وبعدين احذف الأصل")
    if not rows:
        raise LedgerInputError(f"مفيش عمليات للأصل {asset}")
    conn.execute("DELETE FROM holdings WHERE symbol = ?", (asset,))
    conn.execute("DELETE FROM fund_components WHERE fund = ?", (asset,))
    conn.commit()
    return {"removed": rows}


ASSET_KINDS = ("currency", "gold", "bitcoin", "stock", "fund")


def set_asset_kind(conn: sqlite3.Connection, asset: str, kind: str) -> dict:
    """What an asset added by name is (a stock, a fund…): where it shows. A built-in asset's kind is
    the catalog's."""
    if not asset.startswith("custom:"):
        raise LedgerInputError("نوع الأصل ده ثابت من القايمة؛ اللي بيتغيّر نوعه هو اللي اتضاف بالاسم بس")
    if kind not in ASSET_KINDS:
        raise LedgerInputError("اختار نوع الأصل")
    row_id = int(asset.split(":", 1)[1]) if asset.split(":", 1)[1].isdigit() else -1
    if conn.execute("UPDATE custom_assets SET kind = ? WHERE id = ?", (kind, row_id)).rowcount == 0:
        raise LedgerInputError(f"مفيش أصل {asset}")
    conn.execute("UPDATE holdings SET kind = ? WHERE symbol = ?", (kind, asset))
    conn.commit()
    return find(conn, asset)


def relink_custom(conn: sqlite3.Connection, old: str, entry: dict) -> None:
    """An asset added by name that the catalog has (custom:<id> → entry): its purchases, movements,
    dividends, actions and components follow the catalog's key, and the name it was added by goes.
    Its typed prices follow too unless the catalog's asset has a market price of its own. No commit."""
    new = entry["key"]
    conn.execute("UPDATE holdings SET symbol = ?, kind = ?, name = ? WHERE symbol = ?", (new, entry["kind"], entry["name"], old))
    conn.execute("UPDATE holdings SET origin = ? WHERE origin = ?", (f"dividend:{new}", f"dividend:{old}"))
    conn.execute("UPDATE movements SET from_asset = ? WHERE from_asset = ?", (new, old))
    conn.execute("UPDATE movements SET to_asset = ? WHERE to_asset = ?", (new, old))
    conn.execute("UPDATE corporate_actions SET asset = ? WHERE asset = ?", (new, old))
    if new.startswith("fund:"):  # no market price: the typed ones are its price
        conn.execute("UPDATE OR IGNORE manual_prices SET asset = ? WHERE asset = ?", (new, old))
    conn.execute("DELETE FROM manual_prices WHERE asset = ?", (old,))
    for column in ("fund", "asset"):
        conn.execute(f"UPDATE OR IGNORE fund_components SET {column} = ? WHERE {column} = ?", (new, old))
        conn.execute(f"DELETE FROM fund_components WHERE {column} = ?", (old,))
    conn.execute("DELETE FROM custom_assets WHERE id = ?", (int(old.split(":", 1)[1]),))


# ── movements ────────────────────────────────────────────────────────────────

def _num(value: float) -> str:
    return f"{value:,.4f}".rstrip("0").rstrip(".")


def settlement_lots(conn: sqlite3.Connection, today: date) -> list[dict]:
    """What the certificates that settle into EGP paid into the pounds up to today, as purchases of
    EGP (negative ids, never stored) whose origin is the certificate."""
    terms = deposits.load(conn)
    out = []
    for row in conn.execute("SELECT * FROM holdings WHERE kind = 'deposit' ORDER BY id"):
        for i, paid in enumerate(deposits.settlements(terms.get(row["id"]) or {}, row["quantity"], today)):
            out.append({"id": -(row["id"] * 10000 + i + 1), "symbol": "EGP", "quantity": paid["amount"],
                        "buy_price": 1.0, "currency": "EGP", "fx_egp": 1.0, "cost_egp": paid["amount"],
                        "buy_date": paid["date"], "created_at": paid["date"], "updated_at": paid["date"],
                        "note": f"{paid['what']} {row['name']}", "place": None, "origin": row["symbol"]})
    return out


def _book(conn: sqlite3.Connection, value_of=None, today: date | None = None) -> dict:
    """movements.replay over the ledger's purchases (certificates aside, what they paid into EGP
    included), movements and corporate actions."""
    lots = [dict(r) for r in conn.execute("SELECT * FROM holdings WHERE kind != 'deposit' ORDER BY id")]
    lots += settlement_lots(conn, today or now_cairo().date())
    moves = [dict(r) for r in conn.execute("SELECT * FROM movements ORDER BY id")]
    actions = [dict(r) for r in conn.execute("SELECT * FROM corporate_actions ORDER BY id")]
    return movements.replay(lots, moves, value_of or (lambda *_: None), actions)


def _shortfalls(conn: sqlite3.Connection) -> dict:
    return {(s["movement"], s["asset"]): s for s in _book(conn)["short"]}


def _short_text(conn: sqlite3.Connection, short: dict) -> str:
    name = (find(conn, short["asset"]) or {"name": short["asset"]})["name"]
    where = f" في {short['place']}" if short.get("place") else ""
    return (f"رصيد {name}{where} يوم {short['date']} كان {_num(short['held'])}، والحركة محتاجة {_num(short['taken'])}:"
            f" ناقص {_num(short['short'])}.")


def _commit_unless_short(conn: sqlite3.Connection, before: dict, hint: str | None = None) -> None:
    """Commit, unless the change took more than an asset held on some day (a shortfall `before`
    did not have): then nothing is written."""
    new = [s for k, s in _shortfalls(conn).items() if k not in before]
    if new:
        conn.rollback()
        raise LedgerInputError(_short_text(conn, new[0]) + " " + (
            hint or "التعديل ده هيخلّي رصيد بالسالب: عدّل الحركة أو احذفها الأول."))
    conn.commit()


TOP_UP_HINT = "لو الفرق ده فلوس جت من بره، علّم «سجّل الفرق كدخل» وابعت تاني."


def _movable(conn: sqlite3.Connection, key: str | None, message: str) -> dict:
    if key in (None, ""):
        raise LedgerInputError(message)
    if str(key).startswith(DEPOSIT_PREFIX):
        raise LedgerInputError("الشهادات والودائع مش داخلة في التحويلات لسه")
    return _entry(conn, str(key))


def get_movement(conn: sqlite3.Connection, movement_id: int) -> dict:
    row = conn.execute("SELECT * FROM movements WHERE id = ?", (movement_id,)).fetchone()
    if row is None:
        raise LedgerInputError(f"الحركة {movement_id} مش موجودة")
    return dict(row)


def _top_up(conn: sqlite3.Connection, entry: dict, quantity: float, day: str, place: str | None = None) -> None:
    """The shortfall as a purchase on the movement's day, at that day's price (money from outside)."""
    price = price_on(conn, entry, day)
    if price is None or rate_on(conn, price["currency"], day) is None:
        raise LedgerInputError(f"مفيش سعر معروف لـ {entry['name']} يوم {day}: أضف الشرا ده بنفسك من البحث بسعره،"
                               " وبعدين سجّل التحويل")
    _add_holding(conn, entry["key"], price["price"], quantity, None, price["currency"], None, day,
                 "الفرق اتسجّل كدخل مع تحويل", None, commit=False, place=place)


def add_movement(
    conn: sqlite3.Connection,
    kind: str = "transfer",
    from_asset: str | None = None,
    from_quantity: float | None = None,
    to_asset: str | None = None,
    to_quantity: float | None = None,
    date: str | None = None,
    value_egp: float | None = None,
    note: str | None = None,
    top_up: bool = False,
    from_place: str | None = None,
    to_place: str | None = None,
) -> dict:
    """Money leaving an asset: into another (transfer: what left and what arrived, each in its own
    unit; the same asset from one place to another), out of the ledger (expense) or towards a debt
    (repay: to_asset debt:<id>, to_quantity the EGP the debt went down by, what left by default when
    it is pounds). `value_egp` is what the transfer was worth when the user knows it. Taking more
    than the asset (or the named place) held that day is refused, unless `top_up` records the gap as
    money from outside first."""
    if kind not in movements.KIND_LABEL:
        raise LedgerInputError("نوع الحركة لازم يكون تحويل أو خروج أو سداد")
    source = _movable(conn, from_asset, "اختار الأصل اللي الفلوس خرجت منه")
    taken = _positive(from_quantity, "اكتب الكمية اللي خرجت")
    from_place, to_place = _place(from_place), _place(to_place)
    target_key, arrived = None, None
    if kind == "transfer":
        target_key = _movable(conn, to_asset, "اختار الأصل اللي الفلوس راحت له")["key"]
        if target_key == source["key"] and from_place == to_place:
            raise LedgerInputError("التحويل لازم يكون لأصل تاني، أو لنفس الأصل في مكان تاني")
        arrived = _positive(to_quantity, "اكتب الكمية اللي دخلت")
    elif kind == "repay":
        if not str(to_asset or "").startswith(debts.PREFIX):
            raise LedgerInputError("اختار الدين اللي بتسدّده")
        target_key = debts.key(_debt(conn, str(to_asset))["id"])
        if to_quantity in (None, "") and source["key"] == "EGP":
            to_quantity = taken
        arrived = _positive(to_quantity, "اكتب الدين قل قد إيه بالجنيه")
        to_place = None
    elif to_asset not in (None, "") or to_quantity not in (None, ""):
        raise LedgerInputError("الخروج مالوش أصل بيدخل فيه؛ لو الفلوس راحت لأصل تاني سجّلها تحويل")
    day = _day(date) or now_cairo().date().isoformat()
    value = None if value_egp in (None, "") else _positive(value_egp, "القيمة بالجنيه لازم تكون أكبر من صفر")
    before = _shortfalls(conn)
    stamp = now_iso()
    movement_id = conn.execute(
        "INSERT INTO movements (date, kind, from_asset, from_quantity, to_asset, to_quantity, value_egp, note,"
        " created_at, updated_at, from_place, to_place) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (day, kind, source["key"], taken, target_key, arrived, value, (note or "").strip() or None,
         stamp, stamp, from_place, to_place)).lastrowid
    try:
        if top_up:
            gap = _shortfalls(conn).get((movement_id, source["key"]))
            if gap:
                _top_up(conn, source, gap["short"], day, gap["place"])
        _check_debt(conn, target_key)
    except Exception:
        conn.rollback()
        raise
    _commit_unless_short(conn, before, TOP_UP_HINT)
    return get_movement(conn, movement_id)


# ── dividends, bonus shares, splits ──────────────────────────────────────────

def _security(conn: sqlite3.Connection, asset: str | None) -> dict:
    entry = _entry(conn, str(asset or ""))
    if entry["kind"] not in ("stock", "fund"):
        raise LedgerInputError("التوزيعات والأسهم المجانية للأسهم والصناديق بس")
    return entry


def add_dividend(conn: sqlite3.Connection, asset: str | None = None, amount_egp: float | None = None,
                 date: str | None = None, note: str | None = None, place: str | None = None) -> dict:
    """A cash dividend: pounds coming into EGP from a stock or fund (its origin), a return of it,
    not new money."""
    entry = _security(conn, asset)
    amount = _positive(amount_egp, "اكتب مبلغ التوزيعات بالجنيه")
    stamp = now_iso()
    holding_id = conn.execute(
        "INSERT INTO holdings (symbol, quantity, buy_price, buy_date, note, created_at, updated_at, kind, name,"
        " currency, fx_egp, cost_egp, place, origin) VALUES ('EGP', ?, 1, ?, ?, ?, ?, 'currency', 'الجنيه المصري',"
        " 'EGP', 1, ?, ?, ?)",
        (amount, _day(date) or now_cairo().date().isoformat(), (note or "").strip() or f"توزيعات {entry['name']}",
         stamp, stamp, amount, _place(place), f"dividend:{entry['key']}")).lastrowid
    conn.commit()
    return get_holding(conn, holding_id)


def add_corporate_action(conn: sqlite3.Connection, asset: str | None = None, kind: str = "bonus",
                         date: str | None = None, quantity: float | None = None, ratio: float | None = None,
                         note: str | None = None) -> dict:
    """Bonus shares (`quantity`: the shares that came) or a split (`ratio`: 2 is two for one) from
    `date` on: more shares at the same cost."""
    entry = _security(conn, asset)
    if kind == "bonus":
        quantity, ratio = _positive(quantity, "اكتب عدد الأسهم المجانية اللي جاتلك"), None
    elif kind == "split":
        ratio, quantity = _positive(ratio, "اكتب نسبة التقسيم: 2 يعني كل سهم بقى سهمين"), None
        if ratio == 1:
            raise LedgerInputError("نسبة التقسيم 1 مش بتغيّر حاجة")
    else:
        raise LedgerInputError("النوع لازم يكون أسهم مجانية أو تقسيم")
    day = _day(date) or now_cairo().date().isoformat()
    before = _shortfalls(conn)
    action_id = conn.execute(
        "INSERT INTO corporate_actions (asset, date, kind, quantity, ratio, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (entry["key"], day, kind, quantity, ratio, (note or "").strip() or None, now_iso())).lastrowid
    held = _book(conn)["assets"].get(entry["key"])
    event = next((e for e in (held or {}).get("events", []) if e["type"] == "action" and e["id"] == action_id), None)
    if event is None or event["balance"] - event["quantity"] <= movements.EPS:
        conn.rollback()
        raise LedgerInputError(f"مكانش عندك {entry['name']} يوم {day}")
    _commit_unless_short(conn, before)
    return dict(conn.execute("SELECT * FROM corporate_actions WHERE id = ?", (action_id,)).fetchone())


def remove_corporate_action(conn: sqlite3.Connection, action_id: int) -> dict:
    row = conn.execute("SELECT * FROM corporate_actions WHERE id = ?", (action_id,)).fetchone()
    if row is None:
        raise LedgerInputError(f"الإجراء {action_id} مش موجود")
    before = _shortfalls(conn)
    conn.execute("DELETE FROM corporate_actions WHERE id = ?", (action_id,))
    _commit_unless_short(conn, before)
    return {"removed": dict(row)}


# ── what is due soon ─────────────────────────────────────────────────────────

UPCOMING_DAYS = 45


def upcoming(assets: list[dict], owed: list[dict], today: date) -> list[dict]:
    """Certificate payouts and maturities and debt installments in the next UPCOMING_DAYS days."""
    until = (today + timedelta(days=UPCOMING_DAYS)).isoformat()
    out = []
    for a in assets:
        d = a.get("deposit")
        if not d or d["status"] == "matured":
            continue
        if d["next_payout_date"] and d["next_payout_date"] <= until and d["next_payout_date"] != d["maturity_date"]:
            out.append({"date": d["next_payout_date"], "kind": "payout", "label": f"عائد {a['name']}",
                        "amount_egp": d["next_payout_egp"], "key": a["key"]})
        if d["maturity_date"] <= until:
            interest = d["next_payout_egp"] if d["payout"] == "maturity" else 0.0
            out.append({"date": d["maturity_date"], "kind": "maturity", "label": f"استحقاق {a['name']}",
                        "amount_egp": a["quantity"] + (interest or 0.0), "key": a["key"]})
    for debt in owed:
        if debt["next_due_date"] and debt["next_due_date"] <= until:
            out.append({"date": debt["next_due_date"], "kind": "installment", "label": f"قسط {debt['name']}",
                        "amount_egp": debt["installment_egp"], "key": debt["key"]})
    for u in out:
        u["in_days"] = (date.fromisoformat(u["date"]) - today).days
    return sorted(out, key=lambda u: (u["date"], u["label"]))


def _debt(conn: sqlite3.Connection, key: str) -> dict:
    try:
        return debts.get(conn, int(key[len(debts.PREFIX):]))
    except ValueError:
        raise LedgerInputError(f"الدين {key} مش موجود") from None


def add_debt(conn: sqlite3.Connection, name: str | None = None, principal: float | None = None,
             start_date: str | None = None, installment_egp: float | None = None, due_day: int | None = None,
             note: str | None = None, received_into_egp: bool = False, place: str | None = None) -> dict:
    """A debt from its start date (default today). `received_into_egp` also records the borrowed
    pounds as money coming into EGP (at `place`), so what the user is worth does not move."""
    terms = debts.validate(name, principal, start_date or now_cairo().date().isoformat(), installment_egp, due_day)
    try:
        debt_id = debts.add(conn, terms, note)
        if received_into_egp:
            _add_holding(conn, "EGP", 1.0, terms["principal"], None, "EGP", None, terms["start_date"],
                         f"قرض: {terms['name']}", None, commit=False, place=place)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return debts.get(conn, debt_id)


def update_debt(conn: sqlite3.Connection, debt_id: int, name: str | None = None, principal: float | None = None,
                start_date: str | None = None, installment_egp: float | None = None, due_day: int | None = None,
                note: str | None = None) -> dict:
    """Edit a debt (a field left out keeps its value); what was owed can never drop below what was paid."""
    current = debts.get(conn, debt_id)
    terms = debts.validate(current["name"] if name is None else name,
                           current["principal"] if principal in (None, "") else principal,
                           current["start_date"] if start_date in (None, "") else start_date,
                           current["installment_egp"] if installment_egp is None else installment_egp,
                           current["due_day"] if due_day is None else due_day)
    conn.execute("UPDATE debts SET name = ?, principal = ?, start_date = ?, installment_egp = ?, due_day = ?, note = ?,"
                 " updated_at = ? WHERE id = ?",
                 (terms["name"], terms["principal"], terms["start_date"], terms["installment_egp"], terms["due_day"],
                  current["note"] if note is None else (note.strip() or None), now_iso(), debt_id))
    try:
        _check_debt(conn, debts.key(debt_id))
    except Exception:
        conn.rollback()
        raise
    conn.commit()
    return debts.get(conn, debt_id)


def remove_debt(conn: sqlite3.Connection, debt_id: int) -> dict:
    """Remove a debt that has no payments (they are removed first, from the debt's row)."""
    debt = debts.get(conn, debt_id)
    if conn.execute("SELECT 1 FROM movements WHERE to_asset = ? LIMIT 1", (debts.key(debt_id),)).fetchone():
        raise LedgerInputError("الدين ده عليه سدادات: احذفها الأول، وبعدين احذف الدين")
    conn.execute("DELETE FROM debts WHERE id = ?", (debt_id,))
    conn.commit()
    return {"removed": debt}


def _check_debt(conn: sqlite3.Connection, key: str | None) -> None:
    """A debt never goes below zero: its payments add up to what was owed at most."""
    if not key or not key.startswith(debts.PREFIX):
        return
    debt = _debt(conn, key)
    paid = conn.execute("SELECT COALESCE(SUM(to_quantity), 0) FROM movements WHERE kind = 'repay' AND to_asset = ?",
                        (key,)).fetchone()[0]
    if paid > debt["principal"] + movements.EPS:
        raise LedgerInputError(f"السداد أكبر من الباقي من «{debt['name']}»: الدين {_num(debt['principal'])}،"
                               f" والسدادات كده {_num(paid)}")


def update_movement(
    conn: sqlite3.Connection,
    movement_id: int,
    from_quantity: float | None = None,
    to_quantity: float | None = None,
    date: str | None = None,
    value_egp: float | None = None,
    note: str | None = None,
    from_place: str | None = None,
    to_place: str | None = None,
) -> dict:
    """Edit a movement's quantities, day, EGP value, note or places (None keeps one, blank clears
    it); what follows it is worked out again."""
    current = get_movement(conn, movement_id)
    taken = current["from_quantity"] if from_quantity in (None, "") else _positive(from_quantity, "اكتب الكمية اللي خرجت")
    arrived = current["to_quantity"]
    places = (current["from_place"] if from_place is None else _place(from_place),
              current["to_place"] if to_place is None or current["kind"] == "repay" else _place(to_place))
    if current["kind"] == "transfer" and current["to_asset"] == current["from_asset"] and places[0] == places[1]:
        raise LedgerInputError("النقل لنفس الأصل لازم يكون لمكان تاني")
    if to_quantity not in (None, ""):
        if current["kind"] == "expense":
            raise LedgerInputError("الخروج مالوش كمية بتدخل")
        arrived = _positive(to_quantity, "اكتب الكمية اللي دخلت")
    value = current["value_egp"] if value_egp in (None, "") else _positive(value_egp, "القيمة بالجنيه لازم تكون أكبر من صفر")
    before = _shortfalls(conn)
    conn.execute(
        "UPDATE movements SET from_quantity = ?, to_quantity = ?, date = ?, value_egp = ?, note = ?, from_place = ?,"
        " to_place = ?, updated_at = ? WHERE id = ?",
        (taken, arrived, _day(date) or current["date"], value,
         current["note"] if note is None else (note.strip() or None), *places, now_iso(), movement_id))
    try:
        _check_debt(conn, current["to_asset"] if current["kind"] == "repay" else None)
    except Exception:
        conn.rollback()
        raise
    _commit_unless_short(conn, before)
    return get_movement(conn, movement_id)


def remove_movement(conn: sqlite3.Connection, movement_id: int) -> dict:
    """Remove a movement: what left comes back, what arrived goes, unless something later needs it."""
    movement = get_movement(conn, movement_id)
    before = _shortfalls(conn)
    conn.execute("DELETE FROM movements WHERE id = ?", (movement_id,))
    _commit_unless_short(conn, before)
    return {"removed": movement}


def set_fund_components(conn: sqlite3.Connection, fund: str, components: list[dict]) -> dict:
    """Replace what a fund holds: stocks with their weight (0–1). Display only, never summed."""
    entry = _entry(conn, fund)
    if entry["kind"] != "fund":
        raise LedgerInputError("المكونات للصناديق بس")
    rows, seen = [], set()
    for c in components:
        part = _entry(conn, str(c.get("asset") or ""))
        if part["kind"] != "stock":
            raise LedgerInputError("مكون الصندوق لازم يكون سهم")
        weight = _positive(c.get("weight"), "نسبة المكون لازم تكون أكبر من صفر")
        if weight > 1 or part["key"] in seen:
            raise LedgerInputError("كل مكون مرة واحدة، ونسبته 100% أو أقل")
        seen.add(part["key"])
        rows.append((entry["key"], part["key"], weight, now_iso()))
    if sum(r[2] for r in rows) > 1 + 1e-9:
        raise LedgerInputError("مجموع نسب المكونات أكبر من 100%")
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
    keys = ("id", "quantity", "buy_price", "currency", "fx_egp", "cost_egp", "buy_date", "note", "place", "origin",
            "created_at", "updated_at")
    return {k: row[k] for k in keys}


def _usd_total(conn: sqlite3.Connection, value: float | None, at: datetime) -> dict:
    """The EGP total in dollars at the current USD rate; all three None when either is unknown."""
    rate = rate_now(conn, "USD", at)
    if value is None or rate is None or not rate["rate"]:
        return {"value_usd": None, "usd_rate": None, "usd_rate_as_of": None}
    return {"value_usd": value / rate["rate"], "usd_rate": rate["rate"], "usd_rate_as_of": rate["as_of"]}


def _gold_total(conn: sqlite3.Connection, value: float | None, at: datetime) -> dict:
    """The EGP total in grams of 24 karat gold at the latest gram price; None when either is unknown."""
    entry = find(conn, "XAU-G")
    price = resolve_price(conn, entry, at) if entry else None
    if value is None or price is None or not price["price"]:
        return {"value_gold_g": None, "gold_gram_egp": None}
    return {"value_gold_g": value / price["price"], "gold_gram_egp": price["price"]}


def _allocation(groups: list[dict], value: float) -> list[dict]:
    """Each group's share of the priced total, largest first (the closed group has nothing left)."""
    out = [{"group": g["group"], "label": g["label"], "value_egp": sum(a["value_egp"] or 0 for a in g["assets"])}
           for g in groups if g["group"] != CLOSED_GROUP[0]]
    out = [{**g, "share": g["value_egp"] / value} for g in out if g["value_egp"] > 0] if value > 0 else []
    return sorted(out, key=lambda g: -g["value_egp"])


def _deposit_asset(entry: dict, rows: list[dict], terms: dict, at: datetime) -> dict:
    """A certificate or deposit as a ledger row: no price, a value from its terms (store/deposits.py)."""
    principal = sum(r["quantity"] for r in rows)
    cost = sum(r["cost_egp"] for r in rows)
    result = deposits.valued(terms.get(rows[0]["id"]), principal, at)
    detail = result["deposit"]
    return {
        "key": entry["key"], "kind": "deposit", "kind_label": entry["kind_label"], "group": entry["group"],
        "name": entry["name"], "symbol": None, "mark": entry["mark"], "unit": entry["unit"],
        "quantity": principal, "cost_egp": cost, "value_egp": result["value"], "growth": result["value"] / cost - 1,
        "price": None, "price_currency": "EGP", "price_egp": None, "price_as_of": None, "price_source": "terms",
        "stale": False, "today_change": None, "today_as_of": None,
        "interest_per_year": detail and detail["interest_per_year"],
        "next_payout_date": detail and detail["next_payout_date"],
        "maturity_date": detail and detail["maturity_date"],
        "deposit": detail, "lots": [_lot(r) for r in rows], "events": [], "realized_egp": 0.0, "components": [],
    }


CLOSED_GROUP = ("closed", "اتصرفت بالكامل")


def _fallback_entry(key: str, rows: list[dict]) -> dict:
    """An asset the catalog no longer has (a stock that left the index): from its purchases."""
    first = rows[0] if rows else {"kind": "stock", "name": None, "currency": "EGP"}
    return {"key": key, "kind": first["kind"], "group": "stocks", "name": first["name"] or key, "symbol": key,
            "mark": key[:2], "unit": "", "currency": first["currency"], "kind_label": ""}


def _events(raw: list[dict], entries: dict) -> list[dict]:
    """The asset's purchases and movements in order, each movement naming the asset on its other side."""
    out = []
    for e in raw:
        if e["type"] in ("in", "out"):
            other = e["from_asset"] if e["type"] == "in" else e["to_asset"]
            entry = entries.get(other) if other else None
            e = {**e, "other": None if other is None else {
                "key": other, "name": entry["name"] if entry else other, "unit": entry["unit"] if entry else "",
                "kind": entry["kind"] if entry else None, "symbol": entry.get("symbol") if entry else None,
                "mark": entry["mark"] if entry else other[:2]}}
        out.append(e)
    return out


def portfolio_summary(conn: sqlite3.Connection, at: datetime | None = None) -> dict:
    """The ledger: totals in EGP, then the assets in five groups (currencies with gold, bitcoin,
    stocks, funds, certificates and deposits) and the assets whose money all moved on, each asset
    with its purchases (lots), its movements in order (events) and, for a fund, its components."""
    at = at or now_cairo()
    entries = {e["key"]: e for e in catalog(conn)}
    lots: dict[str, list[dict]] = {}
    for row in conn.execute("SELECT * FROM holdings ORDER BY id"):
        lots.setdefault(row["symbol"], []).append(dict(row))
    book = _book(conn, lambda key, quantity, day: value_on(conn, entries.get(key), quantity, day), at.date())
    owed = debts.rows(debts.load(conn), book["debts"], at.date())
    # A repayment's other side is a debt and a certificate's is itself: named in the events like any asset.
    named = {**entries, **{d["key"]: {"key": d["key"], "name": d["name"], "unit": "ج.م", "kind": "debt", "symbol": None,
                                      "mark": "دين"} for d in owed},
             **{key: deposit_entry(key, rows[0]["name"] or "شهادة") for key, rows in lots.items()
                if key.startswith(DEPOSIT_PREFIX)}}
    dividends: dict[str, float] = {}
    for row in lots.get("EGP", []):
        if (row.get("origin") or "").startswith("dividend:"):
            source = row["origin"][len("dividend:"):]
            dividends[source] = dividends.get(source, 0.0) + row["quantity"]

    terms = deposits.load(conn)
    assets = []
    for key, rows in lots.items():
        if key.startswith(DEPOSIT_PREFIX):
            assets.append(_deposit_asset(deposit_entry(key, rows[0]["name"] or "شهادة"), rows, terms, at))
    for key, held in book["assets"].items():
        if key.startswith(DEPOSIT_PREFIX):
            continue  # a certificate bought with the ledger's pounds: valued from its terms above
        rows = lots.get(key, [])
        entry = entries.get(key) or _fallback_entry(key, rows)
        quantity = held["quantity"]
        closed = quantity <= movements.EPS
        # A purchase whose EGP cost is unknown (an old dollar line) makes the asset's cost unknown.
        cost = held["cost"]
        price = resolve_price(conn, entry, at)
        rate = rate_now(conn, price["currency"], at) if price else None
        unit_egp = price["price"] * rate["rate"] if price and rate else None
        value = 0.0 if closed else quantity * unit_egp if unit_egp is not None else None
        fresh = bool(price and price["source"] == "EODHD" and price["stale"] is False and price["change"] is not None)
        # The day's move in EGP, the dollar's own move included for a price in dollars.
        today = quantity * (price["price"] * rate["rate"] - (price["price"] - price["change"]) * rate["previous"]) \
            if fresh and rate else None
        assets.append({
            "key": key, "kind": entry["kind"], "kind_label": entry["kind_label"],
            "group": CLOSED_GROUP[0] if closed else entry["group"],
            "name": entry["name"], "symbol": entry.get("symbol"), "mark": entry["mark"], "unit": entry["unit"],
            "quantity": quantity, "cost_egp": cost, "value_egp": value, "realized_egp": held["realized"],
            "dividends_egp": dividends.get(key, 0.0),
            "growth": value / cost - 1 if value is not None and cost and not closed else None,  # None cost: unknown
            "price": price["price"] if price else None, "price_currency": price["currency"] if price else entry["currency"],
            "price_egp": unit_egp, "price_as_of": price["as_of"] if price else None,
            "price_source": price["source"] if price else None, "stale": price["stale"] if price else None,
            "today_change": today, "today_as_of": price["day"] if fresh else None,
            "places": held["places"], "lots": [_lot(r) for r in rows], "events": _events(held["events"], named),
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
    for group, label in (*GROUPS, CLOSED_GROUP):
        members = [a for a in assets if a["group"] == group]
        if members:
            members.sort(key=lambda a: (a["value_egp"] is None, -(a["value_egp"] or 0), a["name"]))
            groups.append({"group": group, "label": label, "assets": members})
    debt_total = sum(d["remaining_egp"] for d in owed)
    net = value - debt_total if priced else (-debt_total if owed else None)
    usd = _usd_total(conn, net, at)
    gold = _gold_total(conn, net, at)
    places = sorted({p["place"] for a in assets for p in a.get("places") or [] if p["place"]})
    return {
        "as_of": at.isoformat(timespec="minutes"),
        "totals": {
            **usd,
            **gold,
            "allocation": _allocation(groups, value),
            "debts": debt_total, "net_worth": net, "places": places,
            "assets": sum(1 for a in assets if a["group"] != CLOSED_GROUP[0]),
            "realized": sum(a["realized_egp"] for a in assets),
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
        "debts": owed,
        "upcoming": upcoming(assets, owed, at.date()),
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
