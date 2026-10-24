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

-- One row per purchase («السجل»). symbol is the asset key (catalog/__init__.py): an EGX ticker, a
-- currency code, XAU-G / XAU-OZ, BTC, fund:<slug> or custom:<id>. buy_price is in `currency`;
-- cost_egp = quantity × buy_price × fx_egp is fixed at purchase (fx_egp = EGP per unit of currency,
-- the one the user actually paid when they typed the EGP amount).
CREATE TABLE IF NOT EXISTS holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    quantity REAL NOT NULL CHECK (quantity > 0),
    buy_price REAL NOT NULL CHECK (buy_price > 0),
    buy_date TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'stock',
    name TEXT,
    currency TEXT NOT NULL DEFAULT 'EGP',
    fx_egp REAL NOT NULL DEFAULT 1,
    cost_egp REAL,
    place TEXT,
    origin TEXT
);

-- Assets the user adds by name («إضافة بالاسم ده»); key custom:<id>. They stay searchable.
CREATE TABLE IF NOT EXISTS custom_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    symbol TEXT,
    currency TEXT NOT NULL DEFAULT 'EGP',
    created_at TEXT NOT NULL
);

-- Prices the user types, one per asset and day. User data, kept apart from the market cache.
CREATE TABLE IF NOT EXISTS manual_prices (
    asset TEXT NOT NULL,
    date TEXT NOT NULL,
    price REAL NOT NULL CHECK (price > 0),
    currency TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (asset, date)
);

-- One row per Cairo day: the ledger's total and cost when prices were last refreshed.
CREATE TABLE IF NOT EXISTS ledger_snapshots (
    date TEXT PRIMARY KEY,
    value_egp REAL NOT NULL,
    cost_egp REAL NOT NULL,
    assets INTEGER NOT NULL,
    recorded_at TEXT NOT NULL
);

-- What a fund holds, for display only: never added to any total.
CREATE TABLE IF NOT EXISTS fund_components (
    fund TEXT NOT NULL,
    asset TEXT NOT NULL,
    weight REAL NOT NULL CHECK (weight > 0 AND weight <= 1),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (fund, asset)
);

-- A bank certificate or deposit («شهادات وودائع»). Its holding is the principal in EGP (quantity =
-- principal, buy_price 1, symbol deposit:<holding id>). rate is the annual rate as a fraction (0.27).
CREATE TABLE IF NOT EXISTS deposits (
    holding_id INTEGER PRIMARY KEY REFERENCES holdings (id) ON DELETE CASCADE,
    rate REAL NOT NULL CHECK (rate > 0),
    start_date TEXT NOT NULL,
    maturity_date TEXT NOT NULL,
    payout TEXT NOT NULL CHECK (payout IN ('monthly', 'quarterly', 'annual', 'maturity')),
    bank TEXT,
    settle_to_egp INTEGER NOT NULL DEFAULT 0
);

-- A stock's bonus shares (quantity: the shares that came, at no cost) or split (ratio: 2 is two
-- for one), from `date` on. store/movements.py applies them in order with the purchases.
CREATE TABLE IF NOT EXISTS corporate_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset TEXT NOT NULL,
    date TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('bonus', 'split')),
    quantity REAL CHECK (quantity IS NULL OR quantity > 0),
    ratio REAL CHECK (ratio IS NULL OR ratio > 0),
    note TEXT,
    created_at TEXT NOT NULL,
    CHECK ((kind = 'bonus') = (quantity IS NOT NULL) AND (kind = 'split') = (ratio IS NOT NULL))
);

-- «الحركات»: money moving out of an asset, into another (transfer), out of the ledger (expense) or
-- towards a debt (repay: to_asset debt:<id>, to_quantity the EGP the debt went down by). Purchases
-- stay in holdings: each one is money coming in. Quantities are what left and what arrived, in each
-- asset's own unit; value_egp is the EGP the user says the transfer was worth; the places are where
-- the money was and went («البنك الأهلي», «Thndr»), free text.
CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('transfer', 'expense', 'repay')),
    from_asset TEXT NOT NULL,
    from_quantity REAL NOT NULL CHECK (from_quantity > 0),
    to_asset TEXT,
    to_quantity REAL CHECK (to_quantity IS NULL OR to_quantity > 0),
    value_egp REAL CHECK (value_egp IS NULL OR value_egp > 0),
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    from_place TEXT,
    to_place TEXT,
    CHECK ((kind IN ('transfer', 'repay')) = (to_asset IS NOT NULL AND to_quantity IS NOT NULL))
);

-- «ديون وأقساط»: what the user owes. principal is the amount owed from start_date; payments are
-- movements of kind repay. installment_egp and due_day (1-28) only describe the schedule.
CREATE TABLE IF NOT EXISTS debts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    principal REAL NOT NULL CHECK (principal > 0),
    start_date TEXT NOT NULL,
    installment_egp REAL CHECK (installment_egp IS NULL OR installment_egp > 0),
    due_day INTEGER CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 28),
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist (
    symbol TEXT PRIMARY KEY,
    added_at TEXT NOT NULL
);
"""

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
def _ledger_holdings(conn: sqlite3.Connection) -> None:
    """«السجل»: every existing holding becomes a stock in EGP whose cost is quantity × buy_price.
    Quantity and buy_price are not touched. The new tables come from SCHEMA."""
    for column, decl in (("kind", "TEXT NOT NULL DEFAULT 'stock'"), ("name", "TEXT"),
                         ("currency", "TEXT NOT NULL DEFAULT 'EGP'"), ("fx_egp", "REAL NOT NULL DEFAULT 1"),
                         ("cost_egp", "REAL")):
        _add_column("holdings", column, decl)(conn)
    conn.execute("UPDATE holdings SET cost_egp = quantity * buy_price * fx_egp WHERE cost_egp IS NULL")
    from ..universe import load_universe
    names = {c["symbol"]: c.get("name_ar") or c["name"] for c in load_universe()["constituents"]}
    for row in conn.execute("SELECT id, symbol FROM holdings WHERE name IS NULL").fetchall():
        if row["symbol"] in names:
            conn.execute("UPDATE holdings SET name = ? WHERE id = ?", (names[row["symbol"]], row["id"]))


def _dollar_lines(conn: sqlite3.Connection) -> None:
    """Step 2 read every old holding as EGP. A line quoted in dollars (catalog STOCK_CURRENCY, e.g.
    VLMR) was bought in dollars: its EGP cost is unknown until the user gives it (cost_egp NULL;
    fx_egp 0 means «no rate», the column being NOT NULL)."""
    from ..catalog import STOCK_CURRENCY
    for symbol, currency in STOCK_CURRENCY.items():
        conn.execute("UPDATE holdings SET currency = ?, fx_egp = 0, cost_egp = NULL WHERE symbol = ? AND kind = 'stock'"
                     " AND currency = 'EGP' AND fx_egp = 1 AND abs(cost_egp - quantity * buy_price) < 1e-9",
                     (currency, symbol))


_MOVEMENT_COLUMNS = ("id, date, kind, from_asset, from_quantity, to_asset, to_quantity, value_egp, note, created_at,"
                     " updated_at")


def _places_and_repay(conn: sqlite3.Connection) -> None:
    """Purchases get a place; movements get places and the repay kind. A CHECK cannot be altered in
    SQLite, so a movements table from step 6 is copied into the new shape (ids kept) and replaced."""
    _add_column("holdings", "place", "TEXT")(conn)
    columns = {r["name"] for r in conn.execute("PRAGMA table_info(movements)")}
    if "from_place" in columns:
        return  # created by SCHEMA in its current shape
    conn.execute(SCHEMA[SCHEMA.index("CREATE TABLE IF NOT EXISTS movements"):SCHEMA.index("-- «ديون")]
                 .replace("CREATE TABLE IF NOT EXISTS movements", "CREATE TABLE movements_v7"))
    conn.execute(f"INSERT INTO movements_v7 ({_MOVEMENT_COLUMNS}) SELECT {_MOVEMENT_COLUMNS} FROM movements")
    conn.execute("DROP TABLE movements")
    conn.execute("ALTER TABLE movements_v7 RENAME TO movements")


# Note: SCHEMA runs before the steps, so it must not index a column a step adds.
MIGRATIONS: tuple[tuple[int, str, object], ...] = (
    (1, "valuations.report (full Markdown report)", _add_column("valuations", "report", "TEXT")),
    (2, "«السجل»: holdings get kind, name, currency, fx_egp, cost_egp", _ledger_holdings),
    (3, "ledger_snapshots (created by SCHEMA)", lambda conn: None),
    (4, "old purchases of a dollar EGX line are in dollars, their EGP cost unknown", _dollar_lines),
    (5, "deposits (created by SCHEMA)", lambda conn: None),
    (6, "movements (created by SCHEMA)", lambda conn: None),
    (7, "places on purchases and movements, the repay kind, debts", _places_and_repay),
    (8, "holdings.origin (a dividend), deposits.settle_to_egp, corporate_actions",
     lambda conn: (_add_column("holdings", "origin", "TEXT")(conn),
                   _add_column("deposits", "settle_to_egp", "INTEGER NOT NULL DEFAULT 0")(conn))),
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
    copied to data/backups/ first (the user's ledger and the old valuations live in it)."""
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


DAILY_KEEP = 30


def daily_backup(conn: sqlite3.Connection, path: Path, today: str, keep: int = DAILY_KEEP) -> Path | None:
    """One copy a day in data/backups/ (labelled daily-<day>), the newest `keep` kept. None when
    today's copy exists already."""
    folder = path.parent / "backups"
    if folder.exists() and any(folder.glob(f"{path.stem}-*-daily-{today}{path.suffix}")):
        return None
    made = backup(conn, path, f"daily-{today}")
    dailies = sorted(folder.glob(f"{path.stem}-*-daily-*{path.suffix}"), key=lambda p: p.name.rsplit("-daily-", 1)[1])
    for old in dailies[:-keep]:
        old.unlink()
    return made


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
