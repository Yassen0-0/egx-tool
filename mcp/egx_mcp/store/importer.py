"""«استيراد CSV»: the ledger's own export (store/export.py) read back, to move it to another Mac or
bring back purchases and movements kept in Excel.

- `plan` reads the file and says what would be added and what is left out, and why; nothing is
  written. `ledger_import(..., apply=True)` writes the same plan in one go.
- A row that is already in the ledger (the same asset, quantity, price, date and note; or the same
  movement) is left out, so importing a file twice adds nothing the second time.
- An asset added by name (custom:<id>) is matched by its kind and name, or added by name.
- Left out, and said so: certificates (their terms are not in the file), payments of debts and
  pounds into a certificate (debts and certificates are not in it either). Prices are not imported:
  the market's come back with the next refresh.
- Nothing is written when the movements would take more than an asset held on some day.
"""

import csv
import io
import sqlite3

from ..catalog import DEPOSIT_PREFIX, KIND_LABEL, find
from ..errors import LedgerInputError
from . import movements, portfolio
from .db import now_iso

KIND_OF_LABEL = {label: kind for kind, label in KIND_LABEL.items()}
MOVE_KIND_OF_LABEL = {label: kind for kind, label in movements.KIND_LABEL.items()}
MAX_ROWS = 20000


def _number(text: str) -> float | None:
    text = (text or "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        raise LedgerInputError(f"رقم مش مفهوم في الملف: {text}") from None


def _text(text: str) -> str | None:
    return (text or "").strip() or None


def _tables(text: str) -> tuple[list[dict], list[dict]]:
    """The purchases table and the movements table, each row as {code: cell}."""
    rows = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    if len(rows) > MAX_ROWS:
        raise LedgerInputError("الملف أكبر من اللازم")
    tables, codes, current = {}, None, None
    for row in rows:
        if not any(cell.strip() for cell in row):
            codes = None
            continue
        if row and row[0] in ("asset_key", "movement_id"):
            codes, current = row, tables.setdefault(row[0], [])
            continue
        if codes is not None:
            current.append(dict(zip(codes, row + [""] * (len(codes) - len(row)), strict=False)))
    if "asset_key" not in tables:
        raise LedgerInputError("الملف ده مش ملف تصدير من Monos: مفيش فيه صف الرموز (asset_key)")
    return tables["asset_key"], tables.get("movement_id", [])


def _same_lot(conn: sqlite3.Connection, key: str, lot: dict) -> bool:
    return conn.execute(
        "SELECT 1 FROM holdings WHERE symbol = ? AND abs(quantity - ?) < 1e-9 AND abs(buy_price - ?) < 1e-9"
        " AND IFNULL(buy_date, '') = ? AND IFNULL(note, '') = ? LIMIT 1",
        (key, lot["quantity"], lot["buy_price"], lot["buy_date"] or "", lot["note"] or "")).fetchone() is not None


def _same_move(conn: sqlite3.Connection, m: dict) -> bool:
    return conn.execute(
        "SELECT 1 FROM movements WHERE date = ? AND kind = ? AND from_asset = ? AND abs(from_quantity - ?) < 1e-9"
        " AND IFNULL(to_asset, '') = ? AND abs(IFNULL(to_quantity, 0) - ?) < 1e-9 LIMIT 1",
        (m["date"], m["kind"], m["from_asset"], m["from_quantity"], m["to_asset"] or "", m["to_quantity"] or 0)
    ).fetchone() is not None


def _custom_match(conn: sqlite3.Connection, kind: str, name: str) -> str | None:
    row = conn.execute("SELECT id FROM custom_assets WHERE kind = ? AND lower(name) = lower(?)", (kind, name)).fetchone()
    return f"custom:{row['id']}" if row else None


def plan(conn: sqlite3.Connection, text: str) -> dict:
    """What importing the file would add and leave out; writes nothing."""
    lot_rows, move_rows = _tables(text)
    lots, moves, skipped, keys, new_customs = [], [], [], {}, {}
    for n, row in enumerate(lot_rows, start=3):
        key, name = (row.get("asset_key") or "").strip(), _text(row.get("name"))
        if key.startswith(DEPOSIT_PREFIX):
            skipped.append({"row": n, "what": name, "reason": "الشهادات مش بتتنقل من الملف (شروطها مش فيه): ضيفها بإيدك"})
            continue
        quantity, price = _number(row.get("quantity")), _number(row.get("buy_price"))
        if not key or not quantity or not price or quantity <= 0 or price <= 0:
            skipped.append({"row": n, "what": name or key, "reason": "الصف ناقص: الرمز أو الكمية أو السعر"})
            continue
        entry = find(conn, key) if not key.startswith("custom:") else None
        resolved = entry["key"] if entry else None
        custom = None
        if resolved is None:
            kind = KIND_OF_LABEL.get((row.get("kind") or "").strip())
            if kind not in ("currency", "gold", "bitcoin", "stock", "fund") or not name:
                skipped.append({"row": n, "what": name or key, "reason": "أصل مش معروف ومفيش نوعه واسمه في الملف"})
                continue
            resolved = _custom_match(conn, kind, name) or new_customs.setdefault((kind, name.lower()), f"new:{len(new_customs) + 1}")
            if resolved.startswith("new:"):
                custom = {"kind": kind, "name": name, "currency": (row.get("buy_currency") or "EGP").strip().upper()}
        keys[key] = resolved
        lot = {"row": n, "asset": resolved, "name": name or key, "quantity": quantity, "buy_price": price,
               "currency": (row.get("buy_currency") or "EGP").strip().upper(), "cost_egp": _number(row.get("cost_egp")),
               "buy_date": _text(row.get("buy_date")), "note": _text(row.get("note")), "place": _text(row.get("place")),
               "origin": _text(row.get("origin")), "custom": custom}
        if not resolved.startswith("new:") and _same_lot(conn, resolved, lot):
            skipped.append({"row": n, "what": lot["name"], "reason": "موجودة في السجل"})
            continue
        lots.append(lot)
    for row in move_rows:
        kind = MOVE_KIND_OF_LABEL.get((row.get("kind") or "").strip())
        what = f"{_text(row.get('from_name')) or ''} ← {_text(row.get('to_name')) or ''}".strip(" ←")
        to = _text(row.get("to_asset"))
        if kind is None:
            skipped.append({"row": None, "what": what, "reason": "نوع حركة مش معروف"})
            continue
        if kind == "repay" or (to or "").startswith(DEPOSIT_PREFIX):
            skipped.append({"row": None, "what": what, "reason": "الديون والشهادات مش في الملف، فسدادها وشراها مش بيتنقلوا"})
            continue
        source = keys.get(row.get("from_asset"), row.get("from_asset"))
        target = keys.get(to, to) if to else None
        if not source or (find(conn, source) is None and not source.startswith("new:")) or \
                (target and find(conn, target) is None and not target.startswith("new:")):
            skipped.append({"row": None, "what": what, "reason": "أصل في الحركة مش معروف"})
            continue
        m = {"date": _text(row.get("date")), "kind": kind, "from_asset": source, "from_quantity": _number(row.get("from_quantity")),
             "to_asset": target, "to_quantity": _number(row.get("to_quantity")), "note": _text(row.get("note")),
             "from_place": _text(row.get("from_place")), "to_place": _text(row.get("to_place")), "what": what,
             "value_egp": None}
        if kind == "transfer" and source != target and "EGP" not in (source, target):
            m["value_egp"] = _number(row.get("value_egp"))  # what it was worth then, kept
        if not m["date"] or not m["from_quantity"]:
            skipped.append({"row": None, "what": what, "reason": "الحركة ناقصة: التاريخ أو الكمية"})
            continue
        if not source.startswith("new:") and not (target or "").startswith("new:") and _same_move(conn, m):
            skipped.append({"row": None, "what": what, "reason": "موجودة في السجل"})
            continue
        moves.append(m)
    return {"lots": lots, "movements": moves, "skipped": skipped,
            "counts": {"lots": len(lots), "movements": len(moves), "skipped": len(skipped), "new_assets": len(new_customs)}}


def ledger_import(conn: sqlite3.Connection, text: str, apply: bool = False) -> dict:
    """The plan for the file; with `apply`, written in one go (nothing at all when it cannot be)."""
    if not isinstance(text, str) or not text.strip():
        raise LedgerInputError("الملف فاضي")
    result = plan(conn, text)
    if not apply:
        return {**result, "applied": False}
    before = portfolio._shortfalls(conn)
    made: dict[str, str] = {}
    try:
        for lot in result["lots"]:
            key = lot["asset"]
            if key.startswith("new:"):
                key = made.get(key) or portfolio._custom_asset(conn, lot["custom"])["key"]
                made[lot["asset"]] = key
            fx = 1.0 if lot["currency"] == "EGP" else (lot["cost_egp"] / (lot["quantity"] * lot["buy_price"])
                                                       if lot["cost_egp"] else 0.0)
            entry = find(conn, key)
            stamp = now_iso()
            conn.execute(
                "INSERT INTO holdings (symbol, quantity, buy_price, buy_date, note, created_at, updated_at, kind, name,"
                " currency, fx_egp, cost_egp, place, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (key, lot["quantity"], lot["buy_price"], lot["buy_date"], lot["note"], stamp, stamp, entry["kind"],
                 entry["name"], lot["currency"], fx, lot["cost_egp"] if lot["currency"] != "EGP" else lot["quantity"] * lot["buy_price"],
                 lot["place"], lot["origin"]))
        for m in result["movements"]:
            stamp = now_iso()
            conn.execute(
                "INSERT INTO movements (date, kind, from_asset, from_quantity, to_asset, to_quantity, value_egp, note,"
                " created_at, updated_at, from_place, to_place) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (m["date"], m["kind"], made.get(m["from_asset"], m["from_asset"]), m["from_quantity"],
                 made.get(m["to_asset"], m["to_asset"]), m["to_quantity"], m["value_egp"], m["note"], stamp, stamp,
                 m["from_place"], m["to_place"]))
    except Exception:
        conn.rollback()
        raise
    portfolio._commit_unless_short(conn, before, "الملف فيه حركات أكبر من الرصيد: مفيش حاجة اتضافت.")
    return {**result, "applied": True}
