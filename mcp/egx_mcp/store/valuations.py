import sqlite3

from ..errors import ValuationInputError
from ..pricing import pricing_levels
from ..universe import normalize_symbol
from .db import dumps, now_iso, row_to_dict

MATERIAL_CHANGE = 0.0  # every fair-value change is logged; the reason explains it


def latest_valuation(conn: sqlite3.Connection, symbol: str, kind: str | None = None) -> dict | None:
    query = "SELECT * FROM valuations WHERE symbol = ?"
    params: list = [normalize_symbol(symbol)]
    if kind:
        query += " AND kind = ?"
        params.append(kind)
    query += " ORDER BY created_at DESC, id DESC LIMIT 1"
    return row_to_dict(conn.execute(query, params).fetchone())


def valuation_history(conn: sqlite3.Connection, symbol: str, limit: int = 20) -> dict:
    symbol = normalize_symbol(symbol)
    valuations = [
        row_to_dict(r) for r in conn.execute(
            "SELECT id, symbol, created_at, kind, fair_value, bear, bull, entry_price, protection_price,"
            " price_at_valuation, risk_rating, financial_period, reason"
            " FROM valuations WHERE symbol = ? ORDER BY created_at DESC, id DESC LIMIT ?",
            (symbol, limit),
        )
    ]
    changes = [
        dict(r) for r in conn.execute(
            "SELECT * FROM change_log WHERE symbol = ? ORDER BY created_at DESC, id DESC LIMIT ?",
            (symbol, limit),
        )
    ]
    return {"symbol": symbol, "valuations": valuations, "changes": changes}


def latest_per_symbol(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT v.* FROM valuations v JOIN ("
        "  SELECT symbol, MAX(id) AS id FROM valuations GROUP BY symbol"
        ") last ON v.id = last.id ORDER BY v.symbol"
    )
    return [row_to_dict(r) for r in rows]


SUMMARY_COLUMNS = (
    "id, symbol, created_at, kind, fair_value, bear, bull, entry_price, protection_price,"
    " price_at_valuation, risk_rating, financial_period, reason"
)
RATINGS = ("safe", "balanced", "high_risk")


def list_valuations(
    conn: sqlite3.Connection,
    symbol: str | None = None,
    risk_rating: str | None = None,
    kind: str | None = "full",
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """Archive listing, newest first, with the fair-value change against each symbol's previous full valuation.

    Dates are ISO dates (YYYY-MM-DD) compared against the UTC creation date.
    """
    where, params = [], []
    if symbol:
        where.append("symbol = ?")
        params.append(normalize_symbol(symbol))
    if risk_rating:
        if risk_rating not in RATINGS:
            raise ValuationInputError(f"risk_rating must be one of {', '.join(RATINGS)}")
        where.append("risk_rating = ?")
        params.append(risk_rating)
    if kind:
        if kind not in ("full", "light"):
            raise ValuationInputError("kind must be full or light")
        where.append("kind = ?")
        params.append(kind)
    if date_from:
        where.append("substr(created_at, 1, 10) >= ?")
        params.append(date_from)
    if date_to:
        where.append("substr(created_at, 1, 10) <= ?")
        params.append(date_to)
    clause = f" WHERE {' AND '.join(where)}" if where else ""
    limit = max(1, min(int(limit), 200))
    total = conn.execute(f"SELECT COUNT(*) FROM valuations{clause}", params).fetchone()[0]
    rows = conn.execute(
        f"SELECT {SUMMARY_COLUMNS},"
        " (SELECT p.fair_value FROM valuations p WHERE p.symbol = v.symbol AND p.kind = 'full'"
        "   AND p.id < v.id ORDER BY p.id DESC LIMIT 1) AS previous_fair_value"
        f" FROM valuations v{clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
        [*params, limit, max(0, int(offset))],
    )
    items = []
    for row in rows:
        item = dict(row)
        prev = item["previous_fair_value"]
        item["change_pct"] = item["fair_value"] / prev - 1 if prev else None
        items.append(item)
    symbols = [r[0] for r in conn.execute("SELECT DISTINCT symbol FROM valuations ORDER BY symbol")]
    return {"total": total, "limit": limit, "offset": offset, "items": items, "symbols": symbols}


def get_valuation(conn: sqlite3.Connection, valuation_id: int) -> dict:
    """One valuation with everything stored: report, assumptions, methods, sources, sanity, critic notes."""
    row = row_to_dict(conn.execute("SELECT * FROM valuations WHERE id = ?", (valuation_id,)).fetchone())
    if row is None:
        raise ValuationInputError(f"valuation {valuation_id} not found")
    change = conn.execute("SELECT * FROM change_log WHERE valuation_id = ?", (valuation_id,)).fetchone()
    row["change"] = dict(change) if change else None
    return row


def fair_value_series(conn: sqlite3.Connection, symbol: str) -> dict:
    """Every valuation of a symbol in time order, for the fair value vs price chart, plus the change log."""
    symbol = normalize_symbol(symbol)
    points = [
        dict(r) for r in conn.execute(
            "SELECT id, created_at, kind, fair_value, bear, bull, protection_price, price_at_valuation, risk_rating"
            " FROM valuations WHERE symbol = ? ORDER BY created_at, id",
            (symbol,),
        )
    ]
    changes = [
        dict(r) for r in conn.execute(
            "SELECT * FROM change_log WHERE symbol = ? ORDER BY created_at DESC, id DESC", (symbol,),
        )
    ]
    return {"symbol": symbol, "points": points, "changes": changes}


def save_full_valuation(
    conn: sqlite3.Connection,
    symbol: str,
    fair_value: float,
    bear: float,
    bull: float,
    risk_rating: str,
    financial_period: str,
    methods: list[dict],
    assumptions: dict,
    sources: list[dict],
    sanity: dict,
    thesis: str,
    critic_notes: str,
    reason: str,
    price_at_valuation: float | None = None,
    macro_snapshot: dict | None = None,
    risk_details: dict | None = None,
    *,
    report: str,
) -> dict:
    """Persist a full valuation and log the fair-value change against the previous one.

    Refuses valuations whose sanity check failed, that skipped the critic, that
    cite no sources, or that lack the report shown to the user: those are the
    failure modes the tool exists to stop, and the report is what the archive shows.
    """
    symbol = normalize_symbol(symbol)
    if sanity.get("overall") == "fail":
        raise ValuationInputError("sanity check failed; revise the assumptions before saving")
    if not critic_notes.strip():
        raise ValuationInputError("critic_notes are required: run the critic review before saving")
    if not sources:
        raise ValuationInputError("sources are required for every number used")
    if not report.strip():
        raise ValuationInputError("report is required: pass the full report shown to the user")
    if not bear <= fair_value <= bull:
        raise ValuationInputError("expected bear <= fair_value <= bull")

    levels = pricing_levels(fair_value, price_at_valuation)
    if levels.get("review_required") and "protection" not in critic_notes.lower() and "الحماية" not in critic_notes:
        raise ValuationInputError(
            "price is below the protection price: critic_notes must address the below-protection review"
        )

    previous = latest_valuation(conn, symbol, kind="full")
    if previous and not reason.strip():
        raise ValuationInputError("reason is required when a previous valuation exists")

    created_at = now_iso()
    cursor = conn.execute(
        "INSERT INTO valuations (symbol, created_at, kind, fair_value, bear, bull, entry_price, protection_price,"
        " price_at_valuation, risk_rating, financial_period, macro_snapshot, methods, assumptions, sources,"
        " risk_details, sanity, thesis, critic_notes, reason, report)"
        " VALUES (?, ?, 'full', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            symbol, created_at, fair_value, bear, bull, levels["entry_price"], levels["protection_price"],
            price_at_valuation, risk_rating, financial_period, dumps(macro_snapshot), dumps(methods),
            dumps(assumptions), dumps(sources), dumps(risk_details), dumps(sanity), thesis, critic_notes,
            reason or "first valuation", report,
        ),
    )
    valuation_id = cursor.lastrowid
    change = None
    if previous and abs(fair_value - previous["fair_value"]) > MATERIAL_CHANGE:
        change_pct = fair_value / previous["fair_value"] - 1
        conn.execute(
            "INSERT INTO change_log (symbol, created_at, valuation_id, previous_fair_value, new_fair_value,"
            " change_pct, reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (symbol, created_at, valuation_id, previous["fair_value"], fair_value, change_pct, reason),
        )
        change = {"previous_fair_value": previous["fair_value"], "new_fair_value": fair_value,
                  "change_pct": change_pct, "reason": reason}
    conn.commit()
    return {"valuation_id": valuation_id, "symbol": symbol, "pricing": levels, "change": change}


def record_light_update(conn: sqlite3.Connection, symbol: str, current_price: float, notes: str) -> dict:
    """Weekly light update: carries the last full fair value forward with today's price."""
    symbol = normalize_symbol(symbol)
    last_full = latest_valuation(conn, symbol, kind="full")
    if not last_full:
        raise ValuationInputError(f"{symbol} has no full valuation yet; run a full valuation first")
    levels = pricing_levels(last_full["fair_value"], current_price)
    cursor = conn.execute(
        "INSERT INTO valuations (symbol, created_at, kind, fair_value, bear, bull, entry_price, protection_price,"
        " price_at_valuation, risk_rating, financial_period, reason)"
        " VALUES (?, ?, 'light', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            symbol, now_iso(), last_full["fair_value"], last_full["bear"], last_full["bull"],
            levels["entry_price"], levels["protection_price"], current_price, last_full["risk_rating"],
            last_full["financial_period"], notes,
        ),
    )
    conn.commit()
    return {"valuation_id": cursor.lastrowid, "symbol": symbol, "pricing": levels}
