"""«السجل»'s catalog: every asset the search can find, keyed the way holdings.symbol stores it.

- currencies (price = EGP per unit) and gold by gram or ounce, valued as pure gold (docs/تحول.md);
- bitcoin, priced in USD;
- EGX30 stocks from universe/egx30.json, plus any stock the user still holds after it left the index;
- funds from funds.json (empty at first);
- assets the user added by name (custom_assets, key custom:<id>);
- bank certificates and deposits (kind deposit, key deposit:<holding id>): one holding each, valued by
  store/deposits.py and never searched.

`currency` is the asset's own price currency: what a manual price and a buy price default to.
"""

import json
import sqlite3
from functools import cache
from pathlib import Path

from ..universe import load_universe, normalize_symbol

FUNDS_FILE = Path(__file__).with_name("funds.json")

KINDS = ("currency", "gold", "bitcoin", "stock", "fund", "deposit")
KIND_LABEL = {"currency": "عملة", "gold": "ذهب", "bitcoin": "بتكوين", "stock": "سهم", "fund": "صندوق",
              "deposit": "شهادة/وديعة"}
# The screen's five headings, in order. Gold sits with the currencies; its kind stays `gold`.
GROUPS = (("currencies", "عملات"), ("bitcoin", "بتكوين"), ("stocks", "أسهم"), ("funds", "صناديق"),
          ("deposits", "شهادات وودائع"))
GROUP_OF = {"currency": "currencies", "gold": "currencies", "bitcoin": "bitcoin", "stock": "stocks", "fund": "funds",
            "deposit": "deposits"}
UNIT = {"stock": "سهم", "fund": "وثيقة", "bitcoin": "BTC", "deposit": "جنيه"}
DEPOSIT_PREFIX = "deposit:"

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


def deposit_entry(key: str, name: str) -> dict:
    """The ledger's entry for a certificate or deposit (key deposit:<holding id>). Not in `catalog()`:
    it is not something to search for, it exists only as the holding that made it."""
    return _entry(key, "deposit", name, name, None, (), "EGP", None, "شه")


def custom_key(asset_id: int) -> str:
    return f"custom:{asset_id}"


def catalog(conn: sqlite3.Connection) -> list[dict]:
    """Built-in assets, then the user's own, then any held stock the built-in list no longer has."""
    entries = [dict(e) for e in builtin_catalog()]
    known = {e["key"] for e in entries}
    for r in conn.execute("SELECT * FROM custom_assets ORDER BY id"):
        entry = _entry(custom_key(r["id"]), r["kind"], r["name"], r["name"], r["symbol"], (), r["currency"],
                       UNIT.get(r["kind"]) or "وحدة")
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
    # Built-in keys are upper case (usd → USD, xau-g → XAU-G); fund: and custom: keep theirs.
    upper = key if ":" in key else normalize_symbol(key)
    for entry in catalog(conn):
        if entry["key"] in (key, upper):
            return entry
    return None


# ── search (the assistant's; the screen runs the same rules in monos-portfolio/src/search.mjs) ─

_FOLD = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ة": "ه", "ؤ": "و", "ئ": "ي"})
_MARKS = dict.fromkeys([*range(0x064B, 0x0660), 0x0670, 0x0640])
_KIND_ORDER = {"currency": 0, "gold": 1, "bitcoin": 2, "stock": 3, "fund": 4, "deposit": 5}


def normalize(text: str | None) -> str:
    """Lower case; Arabic without diacritics or tatweel, one alef/ya/ha spelling, «ال» dropped."""
    folded = str(text or "").lower().translate(_MARKS).translate(_FOLD)
    return " ".join(w[2:] if w.startswith("ال") and len(w) > 3 else w for w in folded.split())


def _rank(entry: dict, query: str) -> int | None:
    exact = [normalize(t) for t in (entry.get("symbol"), entry["key"], *entry["aliases"]) if t]
    if query in exact:
        return 0
    texts = [normalize(t) for t in (entry["name"], entry["name_en"], *entry["aliases"]) if t]
    if any(t.startswith(query) or any(w.startswith(query) for w in t.split()) for t in texts):
        return 1
    if any(query in t for t in texts):
        return 2
    return None


def search(conn: sqlite3.Connection, query: str, limit: int = 6) -> list[dict]:
    q = normalize(query)
    if not q:
        return []
    hits = [(r, i, e) for i, e in enumerate(catalog(conn)) if (r := _rank(e, q)) is not None]
    # Ties keep the catalog's order, which puts the usual choice first (gold by the gram).
    hits.sort(key=lambda h: (h[0], _KIND_ORDER.get(h[2]["kind"], 9), h[1]))
    return [e for _, _, e in hits[:limit]]
