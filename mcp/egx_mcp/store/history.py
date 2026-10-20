"""«تطوّر ثروتي»: the ledger's total per Cairo day, read back from `ledger_snapshots`
(`portfolio.record_snapshot` writes one row a day). Numbers only: how the total moved."""

import sqlite3
from datetime import datetime, timedelta

from ..market.calendar import now_cairo

DEFAULT_DAYS = 365
MAX_DAYS = 3650


def wealth_history(conn: sqlite3.Connection, days: int = DEFAULT_DAYS, at: datetime | None = None) -> dict:
    """The snapshots of the last `days` days, oldest first, and how the last compares with the first.
    `change` is in EGP and `change_pct` a fraction of the first value (null when it is not above 0).
    The total also moves when the user adds or removes a purchase, so this is a movement, not a return."""
    try:
        days = int(days)
    except (TypeError, ValueError):
        days = DEFAULT_DAYS
    days = min(max(days, 1), MAX_DAYS)
    since = ((at or now_cairo()).date() - timedelta(days=days)).isoformat()
    rows = conn.execute(
        "SELECT date, value_egp, cost_egp FROM ledger_snapshots WHERE date >= ? ORDER BY date", (since,)).fetchall()
    points = [{"date": r[0], "value_egp": r[1], "cost_egp": r[2]} for r in rows]
    if not points:
        return {"points": [], "first": None, "last": None, "change": None, "change_pct": None}
    first, last = points[0], points[-1]
    change = last["value_egp"] - first["value_egp"]
    pct = change / first["value_egp"] if first["value_egp"] > 0 else None
    return {"points": points, "first": first, "last": last, "change": change, "change_pct": pct}
