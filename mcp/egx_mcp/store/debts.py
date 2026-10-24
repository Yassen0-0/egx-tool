"""«ديون وأقساط»: what the user owes, so the ledger can show what they are worth net of it.

A debt is one row of `debts` (key debt:<id>): the amount owed from its start date, and optionally
the installment and the day of the month it falls due, which only describe the schedule. A payment
is a movement of kind repay (store/movements.py): money leaves an asset and the debt goes down by
the EGP the user says it went down by (less than what left when part of it was interest).

What is left = principal − payments, never below zero. Numbers as the user typed them: no
interest is worked out and nothing is forecast.
"""

import sqlite3
from datetime import date

from ..errors import LedgerInputError
from .db import now_iso
from .deposits import add_months

PREFIX = "debt:"


def key(debt_id: int) -> str:
    return f"{PREFIX}{debt_id}"


def _day(value, message: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise LedgerInputError(message)
    try:
        return date.fromisoformat(value.strip()[:10]).isoformat()
    except ValueError:
        raise LedgerInputError("التاريخ لازم يكون بالشكل سنة-شهر-يوم") from None


def validate(name, principal, start_date, installment_egp=None, due_day=None) -> dict:
    name = str(name or "").strip()
    if not name:
        raise LedgerInputError("اكتب اسم الدين: لمين أو إيه هو")
    if len(name) > 80:
        raise LedgerInputError("اسم الدين أطول من اللازم")
    if isinstance(principal, bool) or not isinstance(principal, (int, float)) or not principal > 0:
        raise LedgerInputError("المبلغ اللي عليك لازم يكون أكبر من صفر")
    if installment_egp not in (None, "") and not (isinstance(installment_egp, (int, float)) and installment_egp > 0):
        raise LedgerInputError("القسط لازم يكون أكبر من صفر")
    if due_day not in (None, "") and not (isinstance(due_day, int) and 1 <= due_day <= 28):
        raise LedgerInputError("يوم القسط لازم يكون من 1 لـ 28")
    return {"name": name, "principal": float(principal), "start_date": _day(start_date, "اكتب تاريخ بداية الدين"),
            "installment_egp": None if installment_egp in (None, "") else float(installment_egp),
            "due_day": None if due_day in (None, "") else int(due_day)}


def add(conn: sqlite3.Connection, terms: dict, note: str | None) -> int:
    """Insert a validated debt; the caller commits."""
    stamp = now_iso()
    return conn.execute(
        "INSERT INTO debts (name, principal, start_date, installment_egp, due_day, note, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (terms["name"], terms["principal"], terms["start_date"], terms["installment_egp"], terms["due_day"],
         (note or "").strip() or None, stamp, stamp)).lastrowid


def get(conn: sqlite3.Connection, debt_id: int) -> dict:
    row = conn.execute("SELECT * FROM debts WHERE id = ?", (debt_id,)).fetchone()
    if row is None:
        raise LedgerInputError(f"الدين {debt_id} مش موجود")
    return dict(row)


def load(conn: sqlite3.Connection) -> list[dict]:
    return [dict(r) for r in conn.execute("SELECT * FROM debts ORDER BY start_date, id")]


def next_due(debt: dict, today: date) -> str | None:
    """The next installment day from today on, when the debt has a due day and something is left."""
    if not debt["due_day"]:
        return None
    due = today.replace(day=debt["due_day"])
    if due < today:
        due = add_months(due, 1)
    return due.isoformat()


def remaining_on(debt: dict, payments: list[dict], day: str) -> float:
    """What was left of the debt at the end of `day` (0 before it started: nothing was owed yet)."""
    if debt["start_date"] > day:
        return 0.0
    paid = sum(p["paid_egp"] for p in payments if p["date"] <= day)
    return max(0.0, debt["principal"] - paid)


def rows(debts: list[dict], payments: dict[str, list], today: date) -> list[dict]:
    """The ledger's debts as rows: what was owed, paid and is left, the schedule and the payments."""
    out = []
    for d in debts:
        paid_list = payments.get(key(d["id"]), [])
        paid = sum(p["paid_egp"] for p in paid_list)
        left = max(0.0, d["principal"] - paid)
        out.append({"key": key(d["id"]), "id": d["id"], "name": d["name"], "principal": d["principal"],
                    "start_date": d["start_date"], "paid_egp": paid, "remaining_egp": left,
                    "installment_egp": d["installment_egp"], "due_day": d["due_day"], "note": d["note"],
                    "next_due_date": next_due(d, today) if left > 0 else None, "settled": left <= 0,
                    "payments": paid_list})
    return out
