"""«تصدير CSV»: the ledger as a CSV text, one row per purchase (lot), for a backup or for Excel.

The text starts with a UTF-8 BOM so Excel reads the Arabic; numbers use a dot and dates are ISO.
The values are the ledger's own (store/portfolio.py): an asset's latest known price applied to each
lot, so the rows add up to the screen's totals. A figure that is not known stays an empty cell.
Once money has left an asset (store/movements.py) its lots no longer add up to what is held, so
their value cells stay empty; the movements follow in a second table, one row each.
"""

import csv
import io
from datetime import datetime

from ..market.calendar import now_cairo
from .portfolio import portfolio_summary

BOM = "﻿"

# (code, Arabic title): the first row is the Arabic titles, the second the codes to filter or import on.
COLUMNS = (
    ("asset_key", "رمز الأصل"),
    ("name", "الاسم"),
    ("kind", "النوع"),
    ("group", "المجموعة"),
    ("quantity", "الكمية"),
    ("buy_price", "سعر الشرا"),
    ("buy_currency", "عملة الشرا"),
    ("fx_egp", "سعر التحويل للجنيه"),
    ("cost_egp", "التكلفة بالجنيه"),
    ("buy_date", "تاريخ الشرا"),
    ("note", "ملاحظة"),
    ("place", "المكان"),
    ("origin", "جاي من"),
    ("current_unit_price", "السعر الحالي للوحدة"),
    ("price_currency", "عملة السعر"),
    ("price_date", "تاريخ السعر"),
    ("current_value_egp", "القيمة الحالية بالجنيه"),
    ("growth", "النمو"),
)
GROUP_LABEL = {"currencies": "عملات", "bitcoin": "بتكوين", "stocks": "أسهم", "funds": "صناديق", "closed": "اتصرفت بالكامل"}
MOVEMENT_COLUMNS = (
    ("movement_id", "رقم الحركة"),
    ("date", "التاريخ"),
    ("kind", "النوع"),
    ("from_asset", "رمز اللي خرج منه"),
    ("from_name", "خرج من"),
    ("from_quantity", "الكمية اللي خرجت"),
    ("to_asset", "رمز اللي دخل فيه"),
    ("to_name", "دخل في"),
    ("to_quantity", "الكمية اللي دخلت"),
    ("value_egp", "القيمة بالجنيه"),
    ("realized_egp", "الربح المحقق بالجنيه"),
    ("note", "ملاحظة"),
    ("from_place", "من مكان"),
    ("to_place", "لمكان"),
)


def _cell(value) -> str:
    """A number with a dot and no exponent, a missing figure as an empty cell."""
    if value is None:
        return ""
    if isinstance(value, float):
        text = format(value, ".10f").rstrip("0").rstrip(".")
        return text if text not in ("", "-0") else "0"
    return str(value)


def _row(asset: dict, lot: dict) -> list:
    unit_egp = asset["price_egp"]
    moved_out = any(e["type"] == "out" for e in asset["events"])
    value = lot["quantity"] * unit_egp if unit_egp is not None and not moved_out else None
    cost = lot["cost_egp"]
    growth = value / cost - 1 if value is not None and cost else None
    priced = asset["price"] is not None
    return [
        asset["key"], asset["name"], asset["kind_label"] or asset["kind"], GROUP_LABEL.get(asset["group"], asset["group"]),
        lot["quantity"], lot["buy_price"], lot["currency"], lot["fx_egp"] or None, cost,
        lot["buy_date"], lot["note"], lot.get("place"), lot.get("origin"),
        asset["price"], asset["price_currency"] if priced else None,
        (asset["price_as_of"] or "")[:10] or None, value, growth,
    ]


def ledger_csv(conn, at: datetime | None = None) -> dict:
    """{filename, csv}: a header row of Arabic titles, one of English codes, then one row per
    purchase, grouped by asset in the ledger's order (largest value first inside each group)."""
    at = at or now_cairo()
    summary = portfolio_summary(conn, at)
    out = io.StringIO()
    writer = csv.writer(out, quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
    writer.writerow([title for _, title in COLUMNS])
    writer.writerow([code for code, _ in COLUMNS])
    outs = []
    for group in summary["groups"]:
        for asset in group["assets"]:
            for lot in asset["lots"]:
                writer.writerow([_cell(v) for v in _row(asset, lot)])
            outs += [(asset, e) for e in asset["events"] if e["type"] == "out"]
    if outs:
        writer.writerow([])
        writer.writerow([title for _, title in MOVEMENT_COLUMNS])
        writer.writerow([code for code, _ in MOVEMENT_COLUMNS])
        for asset, e in sorted(outs, key=lambda pair: (pair[1]["date"], pair[1]["movement"])):
            to = e["other"]["name"] if e["other"] else None
            writer.writerow([_cell(v) for v in (
                e["movement"], e["date"], e["kind_label"], asset["key"], asset["name"], e["from_quantity"], e["to_asset"],
                to, e["to_quantity"],
                e["value_egp"], e["realized"], e["note"], e.get("from_place"), e.get("to_place"))])
    return {"filename": f"monos-ledger-{at.date().isoformat()}.csv", "csv": BOM + out.getvalue()}
