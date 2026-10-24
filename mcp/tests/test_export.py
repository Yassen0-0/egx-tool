"""«تصدير CSV»: one row per purchase, a BOM for Excel, Arabic titles over English codes, plain numbers."""

import csv
import io
from datetime import datetime

import pytest

from egx_mcp import cli
from egx_mcp.market.calendar import CAIRO
from egx_mcp.store import portfolio
from egx_mcp.store.db import connect
from egx_mcp.store.export import COLUMNS, ledger_csv

AT = datetime(2026, 10, 15, 8, 0, tzinfo=CAIRO)


@pytest.fixture
def conn(tmp_path):
    connection = connect(tmp_path / "egx.sqlite")
    yield connection
    connection.close()


def rows(result):
    assert result["csv"].startswith("﻿")
    return list(csv.reader(io.StringIO(result["csv"][1:])))


def test_empty_ledger_is_only_the_two_header_rows(conn):
    result = ledger_csv(conn, AT)
    assert result["filename"] == "monos-ledger-2026-10-15.csv"
    table = rows(result)
    assert len(table) == 2
    assert table[0][0] == "رمز الأصل" and table[1] == [code for code, _ in COLUMNS]


def test_one_row_per_lot_with_cost_value_and_growth(conn):
    portfolio.add_holding(conn, "USD", buy_price=30.9, quantity=1000, buy_date="2023-03-01", note="بنك, \"الأهلي\"")
    portfolio.add_holding(conn, "USD", buy_price=40, quantity=500, buy_date="2024-05-02")
    portfolio.set_price(conn, "USD", 48.5, day="2026-10-15")
    table = rows(ledger_csv(conn, AT))
    assert len(table) == 4  # two header rows and two lots
    first, second = (dict(zip(table[1], r, strict=True)) for r in table[2:])
    assert first["asset_key"] == "USD" and first["group"] == "عملات" and first["buy_currency"] == "EGP"
    assert float(first["quantity"]) == 1000 and float(first["buy_price"]) == 30.9
    assert float(first["cost_egp"]) == pytest.approx(30900) and first["buy_date"] == "2023-03-01"
    assert first["note"] == "بنك, \"الأهلي\""  # quoting survives a comma and a quote
    assert float(first["current_unit_price"]) == 48.5 and first["price_currency"] == "EGP"
    assert first["price_date"] == "2026-10-15"
    assert float(first["current_value_egp"]) == pytest.approx(48500)
    assert float(first["growth"]) == pytest.approx(48500 / 30900 - 1)
    assert float(second["current_value_egp"]) == pytest.approx(24250) and second["note"] == ""
    assert float(second["growth"]) == pytest.approx(24250 / 20000 - 1)


def test_numbers_use_dots_and_no_exponent(conn):
    portfolio.add_holding(conn, "USD", buy_price=48.1234, quantity=0.00001234, buy_date="2026-10-01")
    table = rows(ledger_csv(conn, AT))
    row = dict(zip(table[1], table[2], strict=True))
    assert row["quantity"] == "0.00001234" and row["buy_price"] == "48.1234"
    assert all("e" not in row[k].lower() for k in ("quantity", "cost_egp", "fx_egp", "growth"))


def test_an_unpriced_asset_keeps_its_lot_with_empty_value_cells(conn):
    portfolio.add_holding(conn, "CLHO", buy_price=8, quantity=500)
    table = rows(ledger_csv(conn, AT))
    row = dict(zip(table[1], table[2], strict=True))
    assert row["asset_key"] == "CLHO" and float(row["cost_egp"]) == 4000
    assert row["current_unit_price"] == row["current_value_egp"] == row["growth"] == row["price_date"] == ""


def test_the_cli_command_returns_the_same_shape(tmp_path, monkeypatch):
    monkeypatch.setenv("EGX_DB_PATH", str(tmp_path / "cli.sqlite"))
    monkeypatch.setenv("EGX_DATA_DIR", str(tmp_path))
    result = cli.run("ledger-export", None)
    assert set(result) == {"filename", "csv"} and result["csv"].startswith("﻿")


def test_movements_follow_in_their_own_table(conn):
    portfolio.add_holding(conn, "EGP", buy_price=1, amount=1000, buy_date="2026-10-01")
    portfolio.add_movement(conn, "transfer", "EGP", 1000, "USD", 20, date="2026-10-02", note="البنك")
    portfolio.add_movement(conn, "expense", "USD", 5, date="2026-10-03")
    rows = list(csv.reader(io.StringIO(ledger_csv(conn, AT)["csv"].lstrip("﻿"))))
    at = rows.index([])
    assert rows[at + 2][:3] == ["movement_id", "date", "kind"]
    assert rows[at + 3][1:8] == ["2026-10-02", "تحويل", "الجنيه المصري", "1000", "الدولار الأمريكي", "20", "1000"]
    assert rows[at + 3][9] == "البنك" and rows[at + 4][2] == "خروج"
    lot = next(r for r in rows[2:at] if r[0] == "EGP")
    assert lot[13] == "" and lot[14] == ""  # its money moved on: no value per purchase
