"""«الحركات»: where the ledger's money went (docs/الحركات.md). Pure: no database, no prices of its own.

A purchase (a holdings row) is money coming in. A movement takes a quantity out of one asset and
either puts a quantity of another asset in (transfer) or lets it leave the ledger (expense).

`replay` walks every purchase and movement in date order (on one day purchases first, then by id)
and keeps, per asset, the quantity and the EGP cost of what is left:

- what leaves takes the asset's average cost with it (cost × quantity out / quantity held);
- a transfer is worth, in EGP: the value the user gave, else the pounds on either side, else the
  market value on that day of what left, else of what arrived, else the cost that left;
- the asset that arrives costs that value, and the asset that left realised value − cost that left.
  Each asset's growth is then its own, and nothing is counted twice;
- an expense takes its cost out of the ledger; spending is not a gain, so it realises nothing.

Taking more than an asset held on that day is a shortfall: it is reported, and the quantity stops
at zero. The mutations in portfolio.py refuse any change that would create one.
"""

from collections.abc import Callable

EPS = 1e-9
KIND_LABEL = {"transfer": "تحويل", "expense": "خروج"}

ValueOn = Callable[[str, float, str], float | None]


def lot_day(lot: dict) -> str:
    """A purchase without a date counts from the day it was typed in."""
    return lot["buy_date"] or lot["created_at"][:10]


def _blank() -> dict:
    return {"quantity": 0.0, "cost": 0.0, "cost_known": True, "realized": 0.0, "events": []}


def replay(lots: list[dict], moves: list[dict], value_on: ValueOn) -> dict:
    """{"assets": {key: {quantity, cost (None when unknown), realized, events}}, "short": [...]}.
    `value_on(asset, quantity, day)` is the market value in EGP on a day, or None."""
    timeline = [(lot_day(r), 0, r["id"], "lot", r) for r in lots]
    timeline += [(m["date"], 1, m["id"], "move", m) for m in moves]
    timeline.sort(key=lambda e: e[:3])
    state: dict[str, dict] = {}
    short: list[dict] = []
    for day, _, _, kind, row in timeline:
        if kind == "lot":
            s = state.setdefault(row["symbol"], _blank())
            s["quantity"] += row["quantity"]
            if row["cost_egp"] is None:
                s["cost_known"] = False
            else:
                s["cost"] += row["cost_egp"]
            s["events"].append({"type": "lot", "id": row["id"], "date": day, "quantity": row["quantity"],
                                "cost_egp": row["cost_egp"], "balance": s["quantity"]})
            continue
        _move(state, short, row, value_on)
    assets = {key: {"quantity": s["quantity"], "cost": s["cost"] if s["cost_known"] else None,
                    "realized": s["realized"], "events": s["events"]} for key, s in state.items()}
    return {"assets": assets, "short": short}


def _move(state: dict, short: list, m: dict, value_on: ValueOn) -> None:
    out = state.setdefault(m["from_asset"], _blank())
    held, taken, day = out["quantity"], m["from_quantity"], m["date"]
    if taken > held + EPS * max(1.0, held):
        short.append({"movement": m["id"], "asset": m["from_asset"], "date": day, "held": held, "taken": taken,
                      "short": taken - held})
    used = min(taken, held)
    removed = (out["cost"] * used / held if held > EPS else 0.0) if out["cost_known"] else None
    out["quantity"] = max(0.0, held - taken)
    if out["quantity"] <= EPS:
        out.update(quantity=0.0, cost=0.0, cost_known=True)  # nothing left, nothing unknown left
    elif removed is not None:
        out["cost"] = max(0.0, out["cost"] - removed)

    to, arrived = m["to_asset"], m["to_quantity"]
    value = m["value_egp"]
    if value is None:
        value = taken if m["from_asset"] == "EGP" else arrived if to == "EGP" else None
    if value is None:
        value = value_on(m["from_asset"], taken, day)
    if value is None and to:
        value = value_on(to, arrived, day)
    if value is None:
        value = removed

    realized = value - removed if m["kind"] == "transfer" and value is not None and removed is not None else None
    if realized is not None:
        out["realized"] += realized
    base = {"movement": m["id"], "kind": m["kind"], "kind_label": KIND_LABEL[m["kind"]], "date": day,
            "from_asset": m["from_asset"], "from_quantity": taken, "to_asset": to, "to_quantity": arrived,
            "value_egp": value, "value_given": m["value_egp"] is not None, "note": m["note"]}
    out["events"].append({**base, "type": "out", "quantity": -taken, "cost_egp": removed, "realized": realized,
                          "balance": out["quantity"]})
    if m["kind"] != "transfer":
        return
    into = state.setdefault(to, _blank())
    into["quantity"] += arrived
    if value is None:
        into["cost_known"] = False
    else:
        into["cost"] += value
    # What arrived was worth this much at market prices that day: the gap to `value` is the spread.
    market = value_on(to, arrived, day) if to != "EGP" else arrived
    into["events"].append({**base, "type": "in", "quantity": arrived, "cost_egp": value, "market_value_egp": market,
                           "balance": into["quantity"]})
