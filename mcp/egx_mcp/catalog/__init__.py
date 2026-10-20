"""«السجل»'s catalog: every asset the search can find, keyed the way holdings.symbol stores it.

- currencies (price = EGP per unit) and gold by gram or ounce, valued as pure gold (docs/تحول.md);
- bitcoin, priced in USD;
- EGX30 stocks from universe/egx30.json, plus any stock the user still holds after it left the index;
- funds from funds.json (empty at first);
- assets the user added by name (custom_assets, key custom:<id>).

`currency` is the asset's own price currency: what a manual price and a buy price default to.
"""

import json
import sqlite3
from functools import cache
from pathlib import Path

from ..universe import load_universe, normalize_symbol

FUNDS_FILE = Path(__file__).with_name("funds.json")

KINDS = ("currency", "gold", "bitcoin", "stock", "fund")
KIND_LABEL = {"currency": "عملة", "gold": "ذهب", "bitcoin": "بتكوين", "stock": "سهم", "fund": "صندوق"}
# The screen's four headings, in order. Gold sits with the currencies; its kind stays `gold`.
GROUPS = (("currencies", "عملات"), ("bitcoin", "بتكوين"), ("stocks", "أسهم"), ("funds", "صناديق"))
GROUP_OF = {"currency": "currencies", "gold": "currencies", "bitcoin": "bitcoin", "stock": "stocks", "fund": "funds"}
UNIT = {"stock": "سهم", "fund": "وثيقة", "bitcoin": "BTC"}

CURRENCIES = (
    ("EGP", "الجنيه المصري", "Egyptian Pound", ("جنيه", "جنيه مصري", "مصري", "كاش", "نقدي")),
    ("USD", "الدولار الأمريكي", "US Dollar", ("دولار", "دولار امريكي", "$")),
    ("EUR", "اليورو", "Euro", ("يورو", "€")),
    ("SAR", "الريال السعودي", "Saudi Riyal", ("ريال", "ريال سعودي", "سعودي")),
    ("AED", "الدرهم الإماراتي", "UAE Dirham", ("درهم", "درهم اماراتي", "اماراتي")),
    ("GBP", "الجنيه الإسترليني", "British Pound", ("استرليني", "جنيه استرليني", "£")),
)
CURRENCY_CODES = tuple(code for code, *_ in CURRENCIES)

# EGX lines not quoted in EGP. VLMR is the former Egypt Kuwait Holding USD line (EKHO); VLMRA is
# its EGP line.
STOCK_CURRENCY = {"VLMR": "USD"}

GOLD_ALIASES = ("ذهب", "دهب", "gold", "XAU")


def _entry(key, kind, name, name_en, symbol=None, aliases=(), currency="EGP", unit=None, mark=None) -> dict:
    return {
        "key": key, "kind": kind, "kind_label": KIND_LABEL[kind], "group": GROUP_OF[kind], "name": name,
        "name_en": name_en, "symbol": symbol, "aliases": list(aliases), "currency": currency,
        "unit": unit or UNIT.get(kind) or key, "mark": mark or _mark(name, symbol),
    }


def _mark(name: str, symbol: str | None) -> str:
    """The letters drawn in the logo circle when there is no logo file."""
    if symbol:
        return symbol[:3].upper()
    words = [w for w in name.split() if w not in ("صندوق", "شركة")] or name.split() or ["?"]
    return words[0][:2]


@cache
def builtin_catalog() -> tuple[dict, ...]:
    entries = [_entry(code, "currency", name, name_en, code, aliases, "EGP", code, code)
               for code, name, name_en, aliases in CURRENCIES]
    entries.append(_entry("XAU-G", "gold", "الذهب (جرام)", "Gold (gram)", "XAU", GOLD_ALIASES + ("جرام",),
                          "EGP", "جرام", "Au"))
    entries.append(_entry("XAU-OZ", "gold", "الذهب (أونصة)", "Gold (ounce)", "XAU",
                          GOLD_ALIASES + ("اونصة", "أوقية", "ounce"), "EGP", "أونصة", "Au"))
    entries.append(_entry("BTC", "bitcoin", "بيتكوين", "Bitcoin", "BTC", ("بتكوين", "bitcoin", "₿"), "USD",
                          "BTC", "₿"))
    for c in load_universe()["constituents"]:
        entries.append(_entry(c["symbol"], "stock", c.get("name_ar") or c["name"], c["name"], c["symbol"],
                              (c["name"],), STOCK_CURRENCY.get(c["symbol"], "EGP")))
    for f in json.loads(FUNDS_FILE.read_text(encoding="utf-8"))["funds"]:
        entries.append(_entry(f"fund:{f['slug']}", "fund", f["name"], f.get("name_en") or f["name"], None,
                              (*f.get("aliases", ()), *([f["manager"]] if f.get("manager") else [])),
                              f.get("currency", "EGP")))
    return tuple(entries)


def custom_key(asset_id: int) -> str:
    return f"custom:{asset_id}"


def catalog(conn: sqlite3.Connection) -> list[dict]:
    """Built-in assets, then the user's own, then any held stock the built-in list no longer has."""
    entries = [dict(e) for e in builtin_catalog()]
    known = {e["key"] for e in entries}
    for r in conn.execute("SELECT * FROM custom_assets ORDER BY id"):
        entry = _entry(custom_key(r["id"]), r["kind"], r["name"], r["name"], r["symbol"], (), r["currency"])
        entry["custom"] = True
        entries.append(entry)
        known.add(entry["key"])
    for r in conn.execute("SELECT symbol, MAX(name) AS name, MAX(currency) AS currency FROM holdings"
                          " WHERE kind = 'stock' GROUP BY symbol"):
        if r["symbol"] not in known:
            entries.append(_entry(r["symbol"], "stock", r["name"] or r["symbol"], r["name"] or r["symbol"],
                                  r["symbol"], (), r["currency"] or "EGP"))
            known.add(r["symbol"])
    return entries


def find(conn: sqlite3.Connection, key: str) -> dict | None:
    key = key.strip()
    ticker = normalize_symbol(key)
    for entry in catalog(conn):
        if entry["key"] == key or (entry["kind"] == "stock" and entry["key"] == ticker):
            return entry
    return None
