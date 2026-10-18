import json
from functools import cache
from pathlib import Path

UNIVERSE_FILE = Path(__file__).with_name("egx30.json")
# Every constituent's valuation_model is one of these; each maps to one sector skill
# (skills/egx-valuation/SKILL.md §3). tests/test_rules_in_sync.py keeps the three in step.
VALUATION_MODEL_SKILLS = {
    "bank": "egx-sector-banks",
    "holding": "egx-sector-holding",
    "nonbank_financial": "egx-sector-holding",
    "real_estate": "egx-sector-realestate",
    "operating": "egx-sector-operating",
}


@cache
def load_universe() -> dict:
    return json.loads(UNIVERSE_FILE.read_text(encoding="utf-8"))


def constituent(symbol: str) -> dict | None:
    symbol = normalize_symbol(symbol)
    return next((c for c in load_universe()["constituents"] if c["symbol"] == symbol), None)


def normalize_symbol(symbol: str) -> str:
    return symbol.strip().upper().removesuffix(".CA")
