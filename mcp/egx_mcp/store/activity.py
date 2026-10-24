"""«الحركات» across the whole ledger (docs/الحركات.md): every purchase (money coming in), transfer and
expense, newest first, and what a month adds up to. Read from portfolio_summary, so every value,
cost and gain is the one the asset rows show."""

import sqlite3
from datetime import datetime

from ..errors import LedgerInputError
from .portfolio import portfolio_summary

KINDS = {"income": "دخل", "transfer": "تحويل", "expense": "خروج", "repay": "سداد"}


def _side(asset: dict) -> dict:
    return {"key": asset["key"], "name": asset["name"], "unit": asset["unit"], "kind": asset["kind"],
            "symbol": asset.get("symbol"), "mark": asset["mark"]}


def _items(summary: dict) -> list[dict]:
    assets = {a["key"]: a for g in summary["groups"] for a in g["assets"]}
    items = []
    for asset in assets.values():
        for lot in asset["lots"]:
            day = lot["buy_date"] or lot["created_at"][:10]
            source = assets.get((lot.get("origin") or "").removeprefix("dividend:"))
            items.append({"id": f"lot:{lot['id']}", "kind": "income",
                          "kind_label": "توزيعات" if source else KINDS["income"], "date": day,
                          "from": _side(source) if source else None, "from_quantity": None, "to": _side(asset),
                          "to_quantity": lot["quantity"],
                          "value_egp": lot["cost_egp"], "realized_egp": None, "note": lot["note"],
                          "from_place": None, "to_place": lot.get("place")})
        for e in asset["events"]:
            if e["type"] == "lot" and e["id"] < 0:  # what a certificate paid into the pounds
                source = assets.get(e["origin"])
                items.append({"id": f"paid:{-e['id']}", "kind": "income", "kind_label": "عائد", "date": e["date"],
                              "from": _side(source) if source else None, "from_quantity": None, "to": _side(asset),
                              "to_quantity": e["quantity"], "value_egp": e["cost_egp"], "realized_egp": None,
                              "note": e["note"], "from_place": None, "to_place": None})
            if e["type"] != "out":
                continue
            other = assets.get(e["to_asset"]) if e["to_asset"] else None
            to = _side(other) if other else (e["other"] and {**e["other"]})
            items.append({"id": f"move:{e['movement']}", "kind": e["kind"], "kind_label": KINDS[e["kind"]],
                          "date": e["date"], "from": _side(asset), "from_quantity": e["from_quantity"], "to": to,
                          "to_quantity": e["to_quantity"], "value_egp": e["value_egp"], "realized_egp": e["realized"],
                          "note": e["note"], "from_place": e.get("from_place"), "to_place": e.get("to_place")})
    items.sort(key=lambda i: (i["date"], i["id"]), reverse=True)
    return items


def _month(value: str | None) -> str | None:
    if value in (None, ""):
        return None
    try:
        datetime.strptime(value, "%Y-%m")
    except ValueError:
        raise LedgerInputError("الشهر لازم يكون بالشكل سنة-شهر") from None
    return value


def ledger_activity(conn: sqlite3.Connection, month: str | None = None, kind: str | None = None,
                    asset: str | None = None, at: datetime | None = None) -> dict:
    """The movements of one month (YYYY-MM, default every month), one kind (income, transfer, expense)
    or one asset (either side), newest first, with what they add up to in EGP."""
    month = _month(month)
    if kind not in (None, "") and kind not in KINDS:
        raise LedgerInputError("النوع لازم يكون دخل أو تحويل أو خروج أو سداد")
    everything = _items(portfolio_summary(conn, at))
    months = sorted({i["date"][:7] for i in everything}, reverse=True)
    items = [i for i in everything
             if (not month or i["date"].startswith(month)) and (not kind or i["kind"] == kind)
             and (not asset or asset in ((i["from"] or {}).get("key"), (i["to"] or {}).get("key")))]

    def total(which: str) -> float:
        return sum(i["value_egp"] for i in items if i["kind"] == which and i["value_egp"] is not None)

    return {
        "month": month, "kind": kind or None, "asset": asset or None, "months": months, "items": items,
        "totals": {"income_egp": total("income"), "expense_egp": total("expense"), "transfer_egp": total("transfer"),
                   "repay_egp": total("repay"),
                   "realized_egp": sum(i["realized_egp"] for i in items if i["realized_egp"] is not None),
                   "count": len(items)},
    }
