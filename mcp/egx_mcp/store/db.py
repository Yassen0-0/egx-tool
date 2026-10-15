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
    reason TEXT,
    report TEXT
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

CREATE TABLE IF NOT EXISTS daily_bars (
    symbol TEXT NOT NULL,
    date TEXT NOT NULL,
    open REAL, high REAL, low REAL,
    close REAL NOT NULL,
    adjusted_close REAL,
    volume REAL,
    source TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (symbol, date)
);

CREATE TABLE IF NOT EXISTS quotes (
    symbol TEXT PRIMARY KEY,
    price REAL,
    open REAL, high REAL, low REAL, volume REAL,
    previous_close REAL,
    change REAL, change_p REAL,
    quote_time INTEGER,
    source TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_sync (
    symbol TEXT PRIMARY KEY,
    bars_checked_on TEXT,
    quote_checked_at TEXT,
    last_error TEXT
);

CREATE TABLE IF NOT EXISTS sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    plan TEXT,
    daily_limit INTEGER,
    used_before INTEGER,
    calls_made INTEGER,
    summary TEXT,
    error TEXT
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

# Columns added after the first release, applied to existing databases on connect.
MIGRATIONS = (("valuations", "report", "TEXT"),)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)
    for table, column, decl in MIGRATIONS:
        existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
    conn.commit()
    return conn


DEMO_TABLE = "dev_seed"


def is_demo_db(conn: sqlite3.Connection) -> bool:
    """True for a database filled by scripts/seed-dev.py (it creates the dev_seed table)."""
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (DEMO_TABLE,)).fetchone() is not None


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
