"""Bank certificates and deposits («شهادات وودائع»), an asset kind of «السجل».

A deposit is one holding: symbol deposit:<holding id>, quantity = the principal in EGP, buy_price 1,
cost_egp = the principal. Its terms live in the `deposits` table (rate, dates, how the interest is
paid, the bank). Nothing is priced: the value is worked out from the terms and today's date.

- Interest paid out (monthly, quarterly, annual): it leaves the certificate, so the value stays the
  principal and the growth is zero. `interest_to_date` says how much has been paid so far.
- Interest paid at maturity: the certificate holds principal + simple interest accrued to today
  (principal × rate × days / 365), the whole term's interest once it has matured.
- After maturity the certificate shows as matured, never as gone: the user removes it themselves.

These are the terms the user typed, described as numbers; no forecast of anything else.
"""

import sqlite3
from calendar import monthrange
from datetime import date, datetime

from ..errors import LedgerInputError
from .db import now_iso

PAYOUTS = {"monthly": "شهري", "quarterly": "ربع سنوي", "annual": "سنوي", "maturity": "في الآخر"}
_STEP_MONTHS = {"monthly": 1, "quarterly": 3, "annual": 12}
MAX_YEARS = 50


def _rate_text(rate: float) -> str:
    percent = round(rate * 100, 2)
    return f"{percent:g}%"


def _name(bank: str | None, rate: float) -> str:
    return f"شهادة {bank} {_rate_text(rate)}" if bank else f"شهادة بنكية {_rate_text(rate)}"


def _day(value, message: str) -> date:
    if not isinstance(value, str) or not value.strip():
        raise LedgerInputError(message)
    try:
        return date.fromisoformat(value.strip()[:10])
    except ValueError:
        raise LedgerInputError("التاريخ لازم يكون بالشكل سنة-شهر-يوم") from None


def add_months(start: date, months: int) -> date:
    """`start` plus whole months, the day clamped to the month's length (31 Jan + 1 → 28/29 Feb)."""
    index = start.year * 12 + start.month - 1 + months
    year, month = divmod(index, 12)
    return date(year, month + 1, min(start.day, monthrange(year, month + 1)[1]))


def validate(deposit: dict) -> dict:
    """The terms as stored: rate (a fraction), start_date, maturity_date (dates), payout, bank."""
    rate = deposit.get("rate")
    if isinstance(rate, bool) or not isinstance(rate, (int, float)) or not 0 < rate <= 1:
        raise LedgerInputError("العائد السنوي لازم يكون أكبر من صفر و100% أو أقل، ككسر: 27% يتكتب 0.27")
    start = _day(deposit.get("start_date"), "اكتب تاريخ بداية الشهادة")
    maturity = _day(deposit.get("maturity_date"), "اكتب تاريخ استحقاق الشهادة")
    if maturity <= start:
        raise LedgerInputError("تاريخ الاستحقاق لازم يكون بعد تاريخ البداية")
    if maturity > add_months(start, MAX_YEARS * 12):
        raise LedgerInputError(f"مدة الشهادة أطول من {MAX_YEARS} سنة؛ راجع التواريخ")
    payout = deposit.get("payout")
    if payout not in PAYOUTS:
        raise LedgerInputError("اختار طريقة صرف العائد: شهري، أو ربع سنوي، أو سنوي، أو في الآخر")
    bank = str(deposit.get("bank") or "").strip() or None
    if bank and len(bank) > 60:
        raise LedgerInputError("اسم البنك أطول من اللازم")
    return {"rate": float(rate), "start_date": start.isoformat(), "maturity_date": maturity.isoformat(),
            "payout": payout, "bank": bank}


def add(conn: sqlite3.Connection, principal: float, note: str | None, deposit: dict) -> int:
    """Insert the holding and its terms; returns the holding id. Validate first, so a rejected input
    writes nothing. The caller commits."""
    terms = validate(deposit)
    stamp = now_iso()
    holding_id = conn.execute(
        "INSERT INTO holdings (symbol, quantity, buy_price, buy_date, note, created_at, updated_at, kind, name,"
        " currency, fx_egp, cost_egp) VALUES ('deposit:new', ?, 1, ?, ?, ?, ?, 'deposit', ?, 'EGP', 1, ?)",
        (principal, terms["start_date"], (note or "").strip() or None, stamp, stamp,
         _name(terms["bank"], terms["rate"]), principal)).lastrowid
    conn.execute("UPDATE holdings SET symbol = ? WHERE id = ?", (f"deposit:{holding_id}", holding_id))
    conn.execute(
        "INSERT INTO deposits (holding_id, rate, start_date, maturity_date, payout, bank) VALUES (?, ?, ?, ?, ?, ?)",
        (holding_id, terms["rate"], terms["start_date"], terms["maturity_date"], terms["payout"], terms["bank"]))
    return holding_id


TERM_KEYS = ("rate", "start_date", "maturity_date", "payout", "bank")


def update(conn: sqlite3.Connection, holding_id: int, changes: dict) -> dict:
    """Change some of a deposit's terms (any of TERM_KEYS); the holding's name and date follow them.
    Validates the merged terms first, so a rejected change writes nothing. The caller commits."""
    row = conn.execute("SELECT * FROM deposits WHERE holding_id = ?", (holding_id,)).fetchone()
    if row is None:
        raise LedgerInputError("شروط الشهادة مش موجودة")
    terms = validate({**dict(row), **{k: changes[k] for k in TERM_KEYS if k in changes}})
    conn.execute(
        "UPDATE deposits SET rate = ?, start_date = ?, maturity_date = ?, payout = ?, bank = ? WHERE holding_id = ?",
        (terms["rate"], terms["start_date"], terms["maturity_date"], terms["payout"], terms["bank"], holding_id))
    conn.execute("UPDATE holdings SET name = ?, buy_date = ? WHERE id = ?",
                 (_name(terms["bank"], terms["rate"]), terms["start_date"], holding_id))
    return terms


def load(conn: sqlite3.Connection) -> dict[int, dict]:
    """Every deposit's terms, by holding id."""
    return {r["holding_id"]: dict(r) for r in conn.execute("SELECT * FROM deposits")}


def next_payout(terms: dict, today: date) -> date | None:
    """The first payout date from today on (the last one falls on the maturity date); None once matured.
    Dates count from the start date, so the 31st stays the end of the month."""
    start, maturity = date.fromisoformat(terms["start_date"]), date.fromisoformat(terms["maturity_date"])
    if today >= maturity:
        return None
    step = _STEP_MONTHS.get(terms["payout"])
    if step is None:
        return maturity
    k = 1
    while (due := min(add_months(start, k * step), maturity)) < today:
        k += 1
    return due


def valued(terms: dict | None, principal: float, at: datetime) -> dict:
    """What the certificate is worth today and the terms around it. `terms` None (a deposit whose row
    is missing) is valued at its principal."""
    if terms is None:
        return {"value": principal, "deposit": None}
    today = at.date()
    start, maturity = date.fromisoformat(terms["start_date"]), date.fromisoformat(terms["maturity_date"])
    matured = today >= maturity
    days = max(0, (min(today, maturity) - start).days)
    per_year = principal * terms["rate"]
    earned = per_year * days / 365
    value = principal + earned if terms["payout"] == "maturity" else principal
    upcoming = next_payout(terms, today)
    return {
        "value": value,
        "deposit": {
            "rate": terms["rate"], "bank": terms["bank"], "payout": terms["payout"],
            "payout_label": PAYOUTS[terms["payout"]], "start_date": terms["start_date"],
            "maturity_date": terms["maturity_date"], "status": "matured" if matured else "active",
            "days_left": None if matured else (maturity - today).days,
            "interest_per_year": per_year, "interest_to_date": earned,
            "next_payout_date": upcoming.isoformat() if upcoming else None,
        },
    }
