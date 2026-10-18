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

CREATE TABLE IF NOT EXISTS watchlist (
    symbol TEXT PRIMARY KEY,
    added_at TEXT NOT NULL
);
"""

JSON_COLUMNS = ("macro_snapshot", "methods", "assumptions", "sources", "risk_details", "sanity")


def _add_column(table: str, column: str, decl: str):
    def apply(conn: sqlite3.Connection) -> None:
        existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
    return apply


# Numbered schema changes. PRAGMA user_version records the last one applied, so each runs exactly
# once per database and in order. SCHEMA above is the current shape for a new database (every step
# must be a no-op there). To change the schema: add the change to SCHEMA *and* append a step here
# with the next number; never edit or reorder a released step.
MIGRATIONS: tuple[tuple[int, str, object], ...] = (
    (1, "valuations.report (full Markdown report)", _add_column("valuations", "report", "TEXT")),
)
SCHEMA_VERSION = MIGRATIONS[-1][0]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    existed = path.exists() and path.stat().st_size > 0
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    migrate(conn, path if existed else None)
    return conn


def migrate(conn: sqlite3.Connection, backup_from: Path | None = None) -> list[int]:
    """Bring the database to SCHEMA_VERSION; returns the steps applied. An existing database is
    copied to data/backups/ first (the user's portfolio and valuations live in it)."""
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    pending = [m for m in MIGRATIONS if m[0] > version]
    if pending and backup_from is not None:
        backup(conn, backup_from, f"before-v{pending[-1][0]}")
    conn.executescript(SCHEMA)
    for number, _description, apply in pending:
        apply(conn)
        conn.execute(f"PRAGMA user_version = {int(number)}")
    conn.commit()
    return [m[0] for m in pending]


def backup(conn: sqlite3.Connection, path: Path, label: str) -> Path:
    """Consistent copy (SQLite online backup) next to the data: data/backups/<name>-<stamp>-<label>."""
    folder = path.parent / "backups"
    folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = folder / f"{path.stem}-{stamp}-{label}{path.suffix}"
    with sqlite3.connect(target) as copy:
        conn.backup(copy)
    copy.close()
    return target


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
