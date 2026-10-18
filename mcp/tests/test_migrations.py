"""Numbered migrations: an old database is backed up, upgraded once and keeps its rows."""

import sqlite3

from egx_mcp.store.db import SCHEMA_VERSION, connect

OLD_VALUATIONS = """CREATE TABLE valuations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, created_at TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('full', 'light')), fair_value REAL NOT NULL, bear REAL, bull REAL,
    entry_price REAL NOT NULL, protection_price REAL NOT NULL, price_at_valuation REAL, risk_rating TEXT,
    financial_period TEXT, macro_snapshot TEXT, methods TEXT, assumptions TEXT, sources TEXT,
    risk_details TEXT, sanity TEXT, thesis TEXT, critic_notes TEXT, reason TEXT)"""


def test_new_database_is_at_the_current_version(tmp_path):
    conn = connect(tmp_path / "egx.sqlite")
    assert conn.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    assert not (tmp_path / "backups").exists()
    conn.close()


def test_old_database_is_backed_up_and_upgraded(tmp_path):
    path = tmp_path / "egx.sqlite"
    with sqlite3.connect(path) as old:
        old.execute(OLD_VALUATIONS)
        old.execute("INSERT INTO valuations (symbol, created_at, kind, fair_value, entry_price, protection_price)"
                    " VALUES ('COMI', '2026-10-01T10:00:00+00:00', 'full', 100, 100, 80)")
    old.close()
    conn = connect(path)
    columns = {r["name"] for r in conn.execute("PRAGMA table_info(valuations)")}
    assert "report" in columns
    assert conn.execute("SELECT COUNT(*) FROM valuations").fetchone()[0] == 1
    assert conn.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    backups = list((tmp_path / "backups").glob("egx-*-before-v*.sqlite"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as copy:
        assert copy.execute("SELECT COUNT(*) FROM valuations").fetchone()[0] == 1
    conn.close()
    # Reconnecting applies nothing and makes no second backup.
    connect(path).close()
    assert len(list((tmp_path / "backups").glob("*.sqlite"))) == 1
