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
- an expense takes its cost out of the ledger; spending is not a gain, so it realises nothing;
- a repayment takes money towards a debt (debt:<id>): it realises like a sale, and the debt goes
  down by what the user says it went down by (store/debts.py);
- a stock's bonus shares add to what it holds at no cost and a split multiplies it (corporate
  actions, after that day's purchases and movements), in every place in proportion;
- a purchase may carry its origin (dividend:<stock>, deposit:<id> for what a certificate paid):
  money that is a return of another asset, not new money;
- places («البنك الأهلي», «Thndr») are where an asset is: what leaves comes from the named place
  first, else from every place in proportion. The same asset from one place to another is a move
  within it: nothing is sold, its cost moves with it.

Taking more than an asset held on that day, or more than a named place held, is a shortfall: it is
reported, and the quantity stops at zero. The mutations in portfolio.py refuse any change that would create one.
"""

from collections.abc import Callable

EPS = 1e-9
KIND_LABEL = {"transfer": "تحويل", "expense": "خروج", "repay": "سداد"}

ValueOn = Callable[[str, float, str], float | None]


def lot_day(lot: dict) -> str:
    """A purchase without a date counts from the day it was typed in."""
    return lot["buy_date"] or lot["created_at"][:10]


def _cost(s: dict) -> float | None:
    """The EGP cost of what is left, None while part of it is unknown."""
    return s["cost"] if s["cost_known"] else None


def _blank() -> dict:
    return {"quantity": 0.0, "cost": 0.0, "cost_known": True, "realized": 0.0, "events": [], "places": {}}


def _take(places: dict, taken: float, place: str | None) -> None:
    """Take `taken` out of the asset's places: from `place` first when one is named, the rest from
    every place in proportion to what it holds."""
    rest = taken
    if place is not None:
        first = min(rest, max(0.0, places.get(place, 0.0)))
        places[place] = places.get(place, 0.0) - first
        rest -= first
    held = sum(v for v in places.values() if v > 0)
    if rest > EPS and held > EPS:
        share = min(1.0, rest / held)
        for p, v in places.items():
            if v > 0:
                places[p] = v - v * share
    for p in [p for p, v in places.items() if v <= EPS]:
        del places[p]


def _places(s: dict) -> list[dict]:
    """Where the asset is, largest first; empty while nothing has a place."""
    if not any(p is not None for p in s["places"]):
        return []
    return [{"place": p, "quantity": v} for p, v in sorted(s["places"].items(), key=lambda kv: -kv[1])]


def replay(lots: list[dict], moves: list[dict], value_on: ValueOn, actions: list[dict] = ()) -> dict:
    """{"assets": {key: {quantity, cost (None when unknown), realized, places, events}},
    "debts": {debt key: [payments]}, "short": [...]}. `value_on(asset, quantity, day)` is the market
    value in EGP on a day, or None."""
    timeline = [(lot_day(r), 0, r["id"], "lot", r) for r in lots]
    timeline += [(m["date"], 1, m["id"], "move", m) for m in moves]
    timeline += [(a["date"], 2, a["id"], "action", a) for a in actions]
    timeline.sort(key=lambda e: e[:3])
    state: dict[str, dict] = {}
    debts: dict[str, list] = {}
    short: list[dict] = []
    for day, _, _, kind, row in timeline:
        if kind == "lot":
            s = state.setdefault(row["symbol"], _blank())
            s["quantity"] += row["quantity"]
            place = row.get("place")
            s["places"][place] = s["places"].get(place, 0.0) + row["quantity"]
            if row["cost_egp"] is None:
                s["cost_known"] = False
            else:
                s["cost"] += row["cost_egp"]
            s["events"].append({"type": "lot", "id": row["id"], "date": day, "quantity": row["quantity"],
                                "cost_egp": row["cost_egp"], "place": place, "origin": row.get("origin"),
                                "note": row.get("note"), "balance": s["quantity"], "cost_balance": _cost(s)})
            continue
        if kind == "action":
            _action(state.setdefault(row["asset"], _blank()), row)
            continue
        _move(state, debts, short, row, value_on)
    assets = {key: {"quantity": s["quantity"], "cost": s["cost"] if s["cost_known"] else None,
                    "realized": s["realized"], "places": _places(s), "events": s["events"]} for key, s in state.items()}
    return {"assets": assets, "debts": debts, "short": short}


def _action(s: dict, a: dict) -> None:
    """Bonus shares or a split: more shares, the same cost."""
    held = s["quantity"]
    added = a["quantity"] if a["kind"] == "bonus" else held * (a["ratio"] - 1)
    if held > EPS:
        factor = (held + added) / held
        s["places"] = {p: v * factor for p, v in s["places"].items()}
    else:
        s["places"][None] = s["places"].get(None, 0.0) + added
    s["quantity"] = held + added
    s["events"].append({"type": "action", "id": a["id"], "kind": a["kind"], "date": a["date"], "quantity": added,
                        "ratio": a.get("ratio"), "note": a.get("note"), "balance": s["quantity"],
                        "cost_balance": _cost(s)})


def _move(state: dict, debts: dict, short: list, m: dict, value_on: ValueOn) -> None:
    out = state.setdefault(m["from_asset"], _blank())
    held, taken, day = out["quantity"], m["from_quantity"], m["date"]
    from_place, to_place = m.get("from_place"), m.get("to_place")
    if taken > held + EPS * max(1.0, held):
        short.append({"movement": m["id"], "asset": m["from_asset"], "date": day, "held": held, "taken": taken,
                      "short": taken - held, "place": None})
    elif from_place is not None and taken > out["places"].get(from_place, 0.0) + EPS * max(1.0, held):
        there = out["places"].get(from_place, 0.0)
        short.append({"movement": m["id"], "asset": m["from_asset"], "date": day, "held": there, "taken": taken,
                      "short": taken - there, "place": from_place})
    used = min(taken, held)
    removed = (out["cost"] * used / held if held > EPS else 0.0) if out["cost_known"] else None
    out["quantity"] = max(0.0, held - taken)
    _take(out["places"], taken, from_place)
    if out["quantity"] <= EPS:
        out.update(quantity=0.0, cost=0.0, cost_known=True, places={})  # nothing left, nothing unknown left
    elif removed is not None:
        out["cost"] = max(0.0, out["cost"] - removed)

    to, arrived = m["to_asset"], m["to_quantity"]
    within = to == m["from_asset"]  # the same asset from one place to another: nothing is sold
    value = m["value_egp"]
    if value is None and within:
        value = removed
    if value is None:
        value = taken if m["from_asset"] == "EGP" else arrived if to == "EGP" else None
    if value is None:
        value = value_on(m["from_asset"], taken, day)
    if value is None and to and m["kind"] == "transfer":
        value = value_on(to, arrived, day)
    if value is None:
        value = removed

    sold = m["kind"] in ("transfer", "repay") and not within
    realized = value - removed if sold and value is not None and removed is not None else None
    if realized is not None:
        out["realized"] += realized
    base = {"movement": m["id"], "kind": m["kind"], "kind_label": KIND_LABEL[m["kind"]], "date": day,
            "from_asset": m["from_asset"], "from_quantity": taken, "to_asset": to, "to_quantity": arrived,
            "from_place": from_place, "to_place": to_place,
            "value_egp": value, "value_given": m["value_egp"] is not None, "note": m["note"]}
    out["events"].append({**base, "type": "out", "quantity": -taken, "cost_egp": removed, "realized": realized,
                          "balance": out["quantity"], "cost_balance": _cost(out)})
    if m["kind"] == "repay":
        debts.setdefault(to, []).append({**base, "type": "repay", "paid_egp": arrived})
        return
    if m["kind"] != "transfer":
        return
    into = state.setdefault(to, _blank())
    into["quantity"] += arrived
    into["places"][to_place] = into["places"].get(to_place, 0.0) + arrived
    if value is None:
        into["cost_known"] = False
    else:
        into["cost"] += value
    # What arrived was worth this much at market prices that day: the gap to `value` is the spread.
    market = None if within else value_on(to, arrived, day) if to != "EGP" else arrived
    into["events"].append({**base, "type": "in", "quantity": arrived, "cost_egp": value, "market_value_egp": market,
                           "balance": into["quantity"], "cost_balance": _cost(into)})
