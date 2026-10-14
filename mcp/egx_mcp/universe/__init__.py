import json
from functools import cache
from pathlib import Path

UNIVERSE_FILE = Path(__file__).with_name("egx30.json")


@cache
def load_universe() -> dict:
    return json.loads(UNIVERSE_FILE.read_text(encoding="utf-8"))


def constituent(symbol: str) -> dict | None:
    symbol = normalize_symbol(symbol)
    return next((c for c in load_universe()["constituents"] if c["symbol"] == symbol), None)


def normalize_symbol(symbol: str) -> str:
    return symbol.strip().upper().removesuffix(".CA")
