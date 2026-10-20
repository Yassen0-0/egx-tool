"""Numbered migrations: an old database is backed up, upgraded once and keeps its rows."""

import sqlite3

import pytest

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


OLD_HOLDINGS = """CREATE TABLE holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL,
    quantity REAL NOT NULL CHECK (quantity > 0), buy_price REAL NOT NULL CHECK (buy_price > 0),
    buy_date TEXT, note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"""


def test_old_holding_becomes_a_ledger_stock(tmp_path):
    path = tmp_path / "egx.sqlite"
    with sqlite3.connect(path) as old:
        old.execute(OLD_HOLDINGS)
        old.execute("INSERT INTO holdings (symbol, quantity, buy_price, buy_date, note, created_at, updated_at)"
                    " VALUES ('TMGH', 120, 61.25, '2026-09-01', 'x', '2026-09-01T10:00:00+00:00',"
                    " '2026-09-01T10:00:00+00:00')")
        old.execute("PRAGMA user_version = 1")
    old.close()
    conn = connect(path)
    row = dict(conn.execute("SELECT * FROM holdings").fetchone())
    assert (row["symbol"], row["quantity"], row["buy_price"], row["buy_date"], row["note"]) == \
        ("TMGH", 120, 61.25, "2026-09-01", "x")
    assert row["kind"] == "stock" and row["currency"] == "EGP" and row["fx_egp"] == 1
    assert row["cost_egp"] == 120 * 61.25 and row["name"] == "طلعت مصطفى القابضة"
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert {"custom_assets", "manual_prices", "fund_components"} <= tables
    assert len(list((tmp_path / "backups").glob("egx-*-before-v*.sqlite"))) == 1
    conn.close()


def test_an_old_dollar_line_keeps_its_dollars_and_an_unknown_egp_cost(tmp_path):
    path = tmp_path / "egx.sqlite"
    with sqlite3.connect(path) as old:
        old.execute(OLD_HOLDINGS)
        for symbol in ("VLMR", "COMI"):
            old.execute("INSERT INTO holdings (symbol, quantity, buy_price, created_at, updated_at)"
                        " VALUES (?, 100, 0.5, '2026-09-01T10:00:00+00:00', '2026-09-01T10:00:00+00:00')", (symbol,))
        old.execute("PRAGMA user_version = 1")
    old.close()
    conn = connect(path)
    rows = {r["symbol"]: dict(r) for r in conn.execute("SELECT * FROM holdings")}
    assert (rows["VLMR"]["currency"], rows["VLMR"]["cost_egp"], rows["VLMR"]["fx_egp"]) == ("USD", None, 0)
    assert (rows["COMI"]["currency"], rows["COMI"]["cost_egp"]) == ("EGP", 50)
    from egx_mcp.store import portfolio
    totals = portfolio.portfolio_summary(conn)["totals"]
    assert totals["cost"] == 50  # the unknown cost is not a zero
    fixed = portfolio.update_holding(conn, rows["VLMR"]["id"], cost_egp=2400)
    assert fixed["cost_egp"] == 2400 and fixed["fx_egp"] == pytest.approx(48)
    conn.close()
