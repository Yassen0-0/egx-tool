import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS valuations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    created_at TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('full', 'light')),
    fair_value REAL NOT NULL,
    bear REAL,
    bull REAL,
    entry_price REAL NOT NULL,
    protection_price REAL NOT NULL,
    price_at_valuation REAL,
    risk_rating TEXT,
    financial_period TEXT,
    macro_snapshot TEXT,
    methods TEXT,
    assumptions TEXT,
    sources TEXT,
    risk_details TEXT,
    sanity TEXT,
    thesis TEXT,
    critic_notes TEXT,
    reason TEXT
);
CREATE INDEX IF NOT EXISTS valuations_symbol ON valuations (symbol, created_at);

CREATE TABLE IF NOT EXISTS change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    created_at TEXT NOT NULL,
    valuation_id INTEGER NOT NULL REFERENCES valuations (id),
    previous_fair_value REAL NOT NULL,
    new_fair_value REAL NOT NULL,
    change_pct REAL NOT NULL,
    reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    quantity REAL NOT NULL CHECK (quantity > 0),
    buy_price REAL NOT NULL CHECK (buy_price > 0),
    buy_date TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

JSON_COLUMNS = ("macro_snapshot", "methods", "assumptions", "sources", "risk_details", "sanity")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)
    return conn


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    result = dict(row)
    for column in JSON_COLUMNS:
        if result.get(column) is not None:
            result[column] = json.loads(result[column])
    return result


def dumps(value) -> str | None:
    return None if value is None else json.dumps(value, ensure_ascii=False)
