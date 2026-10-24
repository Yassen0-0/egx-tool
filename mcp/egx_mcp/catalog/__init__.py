"""«السجل»'s catalog: every asset the search can find, keyed the way holdings.symbol stores it.

- currencies (price = EGP per unit) and gold: a gram of each karat (its pure gold share of the world
  price), the gold pound (8 g of 21 karat) and the ounce of pure gold (market/prices.py);
- bitcoin, priced in USD;
- EGX30 stocks from universe/egx30.json, plus any stock the user still holds after it left the index;
- S&P 500 funds listed in New York (SPY, IVV, VOO), in dollars, priced by their own close;
- Egyptian mutual funds from funds.json, named as Thndr, the exchange or their own manager lists them,
  with their code, manager and type in the label and the search;
- assets the user added by name (custom_assets, key custom:<id>);
- bank certificates and deposits (kind deposit, key deposit:<holding id>): one holding each, valued by
  store/deposits.py and never searched.

`currency` is the asset's own price currency: what a manual price and a buy price default to.
"""

import json
import re
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
# A fund's type (funds.json): its label, and the words that find it.
FUND_TYPES = {
    "money": ("نقدي", ("نقدي", "سيولة", "money market")),
    "fixed": ("دخل ثابت", ("دخل ثابت", "ادوات دين", "fixed income")),
    "equity": ("أسهم", ("اسهم", "equity")),
    "index": ("مؤشر", ("مؤشر", "اسهم", "index")),
    "balanced": ("متوازن", ("متوازن", "balanced")),
    "gold": ("ذهب", ("ذهب", "دهب", "gold")),
    "silver": ("فضة", ("فضة", "فضه", "silver")),
}
ISLAMIC_ALIASES = ("اسلامي", "شريعة", "متوافق مع الشريعة", "sharia")
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
# S&P 500 funds listed in New York, in dollars; the key is their EODHD ticker (market/prices.py).
SP500_ALIASES = ("s&p 500", "s&p", "sp500", "اس اند بي", "إس آند بي", "اس اند بي 500", "صندوق امريكي")
US_FUNDS = (
    ("SPY.US", "SPY", "صندوق S&P 500 (SPY)", "SPDR S&P 500 ETF Trust"),
    ("IVV.US", "IVV", "صندوق S&P 500 (IVV)", "iShares Core S&P 500 ETF"),
    ("VOO.US", "VOO", "صندوق S&P 500 (VOO)", "Vanguard S&P 500 ETF"),
)
# (key, karat): a gram of gold of that karat. XAU-G is 24 karat, the key it always had. 21 comes
# first: it is what most gold in Egypt is, so a search for «دهب» puts it on top; 22 and 14 come
# after the ounce, so «دهب» still shows the ounce among its six results.
GOLD_GRAMS = (("XAU-G21", 21), ("XAU-G", 24), ("XAU-G18", 18), ("XAU-G22", 22), ("XAU-G14", 14))


# What one unit is called in a question («اشتريت كام جرام؟», «بكام الدولار؟»).
UNIT_NAME = {"stock": "سهم", "fund": "وثيقة", "bitcoin": "بتكوين", "deposit": "جنيه"}
CURRENCY_UNIT_NAME = {code: aliases[0] for code, _, _, aliases in CURRENCIES}


def _entry(key, kind, name, name_en, symbol=None, aliases=(), currency="EGP", unit=None, mark=None) -> dict:
    unit = unit or UNIT.get(kind) or key
    unit_name = CURRENCY_UNIT_NAME.get(key) if kind == "currency" else (unit if kind in ("gold", "fund") else UNIT_NAME.get(kind))
    return {
        "key": key, "kind": kind, "kind_label": KIND_LABEL[kind], "group": GROUP_OF[kind], "name": name,
        "name_en": name_en, "symbol": symbol, "aliases": list(aliases), "currency": currency,
        "unit": unit, "unit_name": unit_name or unit, "mark": mark or _mark(name, symbol),
    }


def _mark(name: str, symbol: str | None) -> str:
    """The letters drawn in the logo circle when there is no logo file."""
    if symbol:
        return symbol[:3].upper()
    words = [w for w in name.split() if w not in ("صندوق", "شركة")] or name.split() or ["?"]
    return words[0][:2]


def _gold_gram(key: str, karat: int) -> dict:
    aliases = tuple(f"{word} {k}" for word in ("ذهب", "دهب", "عيار", "gold") for k in (karat, f"{karat}k"))
    return _entry(key, "gold", f"الذهب عيار {karat} (جرام)", f"Gold {karat}K (gram)", "XAU",
                  GOLD_ALIASES + aliases + (f"ذهب عيار {karat}", f"دهب عيار {karat}", "جرام"), "EGP", "جرام", "Au")


@cache
def builtin_catalog() -> tuple[dict, ...]:
    entries = [_entry(code, "currency", name, name_en, code, aliases, "EGP", code, code)
               for code, name, name_en, aliases in CURRENCIES]
    entries += [_gold_gram(key, karat) for key, karat in GOLD_GRAMS[:3]]
    entries.append(_entry("XAU-COIN", "gold", "الجنيه الذهب", "Gold pound (8 g, 21K)", "XAU",
                          GOLD_ALIASES + ("جنيه ذهب", "جنيه دهب", "جنيه الذهب", "gold pound"), "EGP", "جنيه ذهب", "Au"))
    entries.append(_entry("XAU-OZ", "gold", "الذهب (أونصة)", "Gold (ounce)", "XAU",
                          GOLD_ALIASES + ("اونصة", "أوقية", "ounce"), "EGP", "أونصة", "Au"))
    entries += [_gold_gram(key, karat) for key, karat in GOLD_GRAMS[3:]]
    entries.append(_entry("BTC", "bitcoin", "بيتكوين", "Bitcoin", "BTC", ("بتكوين", "bitcoin", "₿"), "USD",
                          "BTC", "₿"))
    for c in load_universe()["constituents"]:
        entries.append(_entry(c["symbol"], "stock", c.get("name_ar") or c["name"], c["name"], c["symbol"],
                              (c["name"],), STOCK_CURRENCY.get(c["symbol"], "EGP")))
    for key, symbol, name, name_en in US_FUNDS:
        entries.append(_entry(key, "fund", name, name_en, symbol, SP500_ALIASES + (name_en,), "USD", "وحدة", symbol))
    funds = json.loads(FUNDS_FILE.read_text(encoding="utf-8"))
    entries += [_fund(f, funds.get("managers", {})) for f in funds["funds"]]
    return tuple(entries)


def _fund(f: dict, managers: dict) -> dict:
    """A fund from funds.json: «صندوق ذهب · بلتون» as its label; its code, names, manager, type and
    «إسلامي» find it."""
    manager = managers.get(f.get("manager") or "", {})
    label, type_words = FUND_TYPES.get(f.get("type") or "", (None, ()))
    entry = _entry(f"fund:{f['slug']}", "fund", f["name"], f.get("name_en") or f["name"], f.get("symbol"),
                   f.get("aliases", ()), f.get("currency", "EGP"))
    # Words that find it among others but never name it alone: «بلتون» starts it, it is not «بلتون».
    entry["tags"] = [*([manager["name"]] if manager else ()), *manager.get("aliases", ()), *type_words,
                     *(ISLAMIC_ALIASES if f.get("islamic") else ())]
    entry["kind_label"] = " · ".join(filter(None, (f"صندوق {label}" if label else "صندوق", manager.get("name"))))
    entry["mark"] = manager.get("mark") or _mark(f["name"], f.get("symbol"))
    return entry


def deposit_entry(key: str, name: str) -> dict:
    """The ledger's entry for a certificate or deposit (key deposit:<holding id>). Not in `catalog()`:
    it is not something to search for, it exists only as the holding that made it."""
    return _entry(key, "deposit", name, name, None, (), "EGP", None, "شه")


def custom_key(asset_id: int) -> str:
    return f"custom:{asset_id}"


EGX_TICKER = re.compile(r"[A-Z0-9]{2,6}")


def egx_ticker(key: str, kind: str, symbol: str | None = None) -> str | None:
    """The EGX ticker whose daily close prices a stock line: a built-in stock's own key, or the symbol
    of a stock the user added by name when it looks like an EGX ticker (2-6 letters or digits, no
    dot). None for anything else: such a line stays on the user's own price."""
    if kind != "stock":
        return None
    if ":" not in key:
        return key if "." not in key else None
    if key.startswith("custom:") and symbol:
        symbol = symbol.strip().upper()
        return symbol if EGX_TICKER.fullmatch(symbol) else None
    return None


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


def match(name: str | None, symbol: str | None = None) -> dict | None:
    """The built-in asset something added by name really is: its code («SPY» is SPY.US) or its exact
    name or alias («S&P 500 ETF» alone is not enough). None unless exactly one fits."""
    def one(found: list[dict]) -> dict | None:
        return found[0] if len({e["key"] for e in found}) == 1 else None
    code = normalize(symbol)
    if code:
        hit = one([e for e in builtin_catalog() if code in (normalize(e["symbol"]), normalize(e["key"]))])
        if hit:
            return hit
    text = normalize(name)
    if not text:
        return None
    return one([e for e in builtin_catalog()
                if text in {normalize(t) for t in (e["name"], e["name_en"], e["symbol"], *e["aliases"]) if t}])


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
_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_KIND_ORDER = {"currency": 0, "gold": 1, "bitcoin": 2, "stock": 3, "fund": 4, "deposit": 5}


def normalize(text: str | None) -> str:
    """Lower case; Arabic without diacritics or tatweel, one alef/ya/ha spelling, Latin digits, «ال»
    dropped, and dashes, dots, slashes and brackets as spaces («b-secure» finds «B Secure»)."""
    folded = str(text or "").lower().translate(_MARKS).translate(_FOLD).translate(_DIGITS)
    folded = _SEPARATORS.sub(" ", folded)
    return " ".join(w[2:] if w.startswith("ال") and len(w) > 3 else w for w in folded.split())


_SEPARATORS = re.compile(r"[-_./\\()\[\],،:؛;]+")
# Words that say what kind of thing it is, not which: dropped from a longer query («صندوق بلتون»).
_FILLER = {"صندوق", "fund", "سهم", "شركه", "وثيقه", "وثايق"}
# The same key on the Arabic and the English keyboard: «ؤخةه» is «comi» typed in the wrong language.
_AR_KEYS, _EN_KEYS = "ضصثقفغعهخحجدشسيبلاتنمكطئءؤرىةوزظ", "qwertyuiop[]asdfghjkl;'zxcvnm,./"
_LAYOUT = {**dict(zip(_AR_KEYS, _EN_KEYS, strict=True)), **dict(zip(_EN_KEYS, _AR_KEYS, strict=True)), "b": "لا"}


def _osa(a: str, b: str) -> int:
    """Edit distance counting a swap of two neighbours as one edit («بلتنو» → «بلتون»)."""
    prev2, prev = None, list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * len(b)
        for j in range(1, len(b) + 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] != b[j - 1]))
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                cur[j] = min(cur[j], prev2[j - 2] + 1)
        prev2, prev = prev, cur
    return prev[-1]


def _typo(part: str, word: str) -> int | None:
    """How many edits a typo is from the word or its start; None when it is too far to be one (one
    edit in a short word, two in a long one, nothing under three letters)."""
    if word.startswith(part):
        return 0
    if len(part) < 3:
        return None
    d = min(_osa(part, word), _osa(part, word[:len(part)]))
    return d if d <= (1 if len(part) <= 5 else 2) else None


def _rank(entry: dict, query: str) -> float | None:
    exact = [normalize(t) for t in (entry.get("symbol"), entry["key"], *entry["aliases"]) if t]
    if query in exact:
        return 0
    texts = [normalize(t) for t in (entry["name"], entry["name_en"], *entry["aliases"], *entry.get("tags", ())) if t]
    if any(f" {t}".find(f" {query}") >= 0 for t in texts):  # from the start of a word on
        return 1
    if any(query in t for t in texts):
        return 2
    words = {w for t in texts + exact for w in t.split()}
    parts = [q for q in query.split() if q not in _FILLER] or query.split()
    # «بلتون ذهب»: every word starts a word somewhere in the names and aliases.
    if all(any(w.startswith(q) for w in words) for q in parts):
        return 3
    # Typos: «بلتوون», «سبايك», «azimot»; and the spaces left out or added («ميامية»). 4 and up, the
    # fewer edits the better.
    edits = [min((d for w in words if (d := _typo(q, w)) is not None), default=None) for q in parts]
    if None not in edits:
        return 4 + sum(edits) / 10
    joined = query.replace(" ", "")
    spaced = [d for t in texts if len(joined) >= 4 and (d := _typo(joined, t.replace(" ", ""))) is not None]
    return 4 + min(spaced) / 10 if spaced else None


def search(conn: sqlite3.Connection, query: str, limit: int = 6) -> list[dict]:
    q = normalize(query)
    if not q:
        return []
    entries = catalog(conn)
    hits = [(r, i, e) for i, e in enumerate(entries) if (r := _rank(e, q)) is not None]
    if not hits:
        # Nothing at all: maybe it was typed with the keyboard in the other language.
        swapped = normalize("".join(_LAYOUT.get(c, c) for c in str(query).lower()))
        hits = [(r, i, e) for i, e in enumerate(entries) if swapped and (r := _rank(e, swapped)) is not None]
    if any(r <= 2 for r, _, _ in hits):
        hits = [h for h in hits if h[0] < 4]  # a close match makes the typo guesses noise
    # Ties keep the catalog's order, which puts the usual choice first (gold by the gram).
    hits.sort(key=lambda h: (h[0], _KIND_ORDER.get(h[2]["kind"], 9), h[1]))
    return [e for _, _, e in hits[:limit]]
