"""Bank certificates and deposits («شهادات وودائع»), an asset kind of «السجل».

A deposit is one holding: symbol deposit:<holding id>, quantity = the principal in EGP, buy_price 1,
cost_egp = the principal. Its terms live in the `deposits` table (rate, dates, how the interest is
paid, the bank). Nothing is priced: the value is worked out from the terms and today's date.

- Interest paid out (monthly, quarterly, annual): it leaves the certificate, so the value stays the
  principal and the growth is zero. `interest_to_date` says how much has been paid so far.
- Interest paid at maturity: the certificate holds principal + simple interest accrued to today
  (principal × rate × days / 365), the whole term's interest once it has matured.
- After maturity the certificate shows as matured, never as gone: the user removes it themselves.
- A certificate that settles into EGP (settle_to_egp, the default for a new one): each payout, and
  at maturity the principal (with the interest when it is paid at the end), come into the pounds
  of the ledger on their day (`settlements`), and once matured it is worth nothing more itself. A
  regular payout is the annual rate over 12 per month of the period, as banks pay it; a shorter
  last period counts its days.

These are the terms the user typed, described as numbers; no forecast of anything else.
"""

import sqlite3
from calendar import monthrange
from datetime import date, datetime, timedelta

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
    start = _day(deposit.get("start_date"), "اكتب الشهادة اتفتحت إمتى")
    years = deposit.get("term_years")
    if deposit.get("maturity_date") in (None, "") and isinstance(years, int) and not isinstance(years, bool) and 0 < years <= MAX_YEARS:
        maturity = add_months(start, years * 12)  # «مدتها 3 سنين»
    else:
        maturity = _day(deposit.get("maturity_date"), "اختار مدتها، أو اكتب بتخلص إمتى")
    if maturity <= start:
        raise LedgerInputError("تاريخ الخلوص لازم يكون بعد تاريخ الفتح")
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


def add(conn: sqlite3.Connection, principal: float, note: str | None, deposit: dict, settle_to_egp: bool = False) -> int:
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
        "INSERT INTO deposits (holding_id, rate, start_date, maturity_date, payout, bank, settle_to_egp)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (holding_id, terms["rate"], terms["start_date"], terms["maturity_date"], terms["payout"], terms["bank"],
         1 if settle_to_egp else 0))
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


def payout_amount(terms: dict, principal: float, previous: date, due: date) -> float:
    """One payout: rate / 12 per month of a full period, the days of a shorter last one."""
    step = _STEP_MONTHS[terms["payout"]]
    if due == add_months(previous, step):
        return principal * terms["rate"] * step / 12
    return principal * terms["rate"] * (due - previous).days / 365


def schedule(terms: dict) -> list[tuple[date, date]]:
    """(previous, due) of every regular payout up to maturity; empty when paid at the end."""
    step = _STEP_MONTHS.get(terms["payout"])
    if step is None:
        return []
    start, maturity = date.fromisoformat(terms["start_date"]), date.fromisoformat(terms["maturity_date"])
    out, k, previous = [], 1, start
    while True:
        due = min(add_months(start, k * step), maturity)
        out.append((previous, due))
        if due >= maturity:
            return out
        previous, k = due, k + 1


def settlements(terms: dict, principal: float, until: date) -> list[dict]:
    """What the certificate paid into EGP up to `until`: each payout, then the principal at maturity
    (with the whole interest when it is paid at the end). Empty unless it settles into EGP."""
    if not terms.get("settle_to_egp"):
        return []
    start, maturity = date.fromisoformat(terms["start_date"]), date.fromisoformat(terms["maturity_date"])
    out = [{"date": due.isoformat(), "amount": payout_amount(terms, principal, previous, due), "what": "عائد"}
           for previous, due in schedule(terms) if due <= until]
    if maturity <= until:
        interest = principal * terms["rate"] * (maturity - start).days / 365 if terms["payout"] == "maturity" else 0.0
        out.append({"date": maturity.isoformat(), "amount": principal + interest, "what": "استحقاق"})
    return out


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
    if matured and terms.get("settle_to_egp"):
        value = 0.0  # its money came back into the pounds on the maturity day
    # One that settles into EGP was already paid today's payout: its next one is after today.
    upcoming = next_payout(terms, today + timedelta(days=1) if terms.get("settle_to_egp") else today)
    pending = [(p, d) for p, d in schedule(terms) if d == upcoming]
    return {
        "value": value,
        "deposit": {
            "rate": terms["rate"], "bank": terms["bank"], "payout": terms["payout"],
            "payout_label": PAYOUTS[terms["payout"]], "start_date": terms["start_date"],
            "maturity_date": terms["maturity_date"], "status": "matured" if matured else "active",
            "days_left": None if matured else (maturity - today).days,
            "interest_per_year": per_year, "interest_to_date": earned,
            "next_payout_date": upcoming.isoformat() if upcoming else None,
            "next_payout_egp": None if upcoming is None else (
                payout_amount(terms, principal, *pending[0]) if pending
                else principal * terms["rate"] * (maturity - start).days / 365),
            "settle_to_egp": bool(terms.get("settle_to_egp")),
        },
    }
