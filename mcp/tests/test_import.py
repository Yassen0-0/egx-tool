"""«استيراد CSV»: the ledger's own export read back — a plan first, nothing twice, and what is left out said."""

import json
import subprocess
import sys
from datetime import datetime

import pytest

from egx_mcp.errors import LedgerInputError
from egx_mcp.market.calendar import CAIRO
from egx_mcp.store import portfolio
from egx_mcp.store.db import connect
from egx_mcp.store.export import ledger_csv
from egx_mcp.store.importer import ledger_import

AT = datetime(2026, 10, 15, 8, 0, tzinfo=CAIRO)


def ledger(path):
    conn = connect(path)
    portfolio.add_holding(conn, "EGP", buy_price=1, amount=10000, buy_date="2026-09-01", place="الأهلي", note="مرتب")
    portfolio.add_holding(conn, "USD", buy_price=48, quantity=100, buy_date="2026-09-02", cost_egp=4800)
    portfolio.add_holding(conn, None, buy_price=10, quantity=50, buy_date="2026-09-03",
                          custom={"kind": "fund", "name": "صندوق مصر الذهبي", "currency": "EGP"})
    portfolio.add_movement(conn, "transfer", "EGP", 1000, "USD", 20, date="2026-09-10", from_place="الأهلي", note="البنك")
    portfolio.add_movement(conn, "expense", "EGP", 500, date="2026-09-11")
    portfolio.add_holding(conn, amount=50000, deposit={"rate": 0.2, "start_date": "2026-09-01", "maturity_date": "2027-09-01",
                                                       "payout": "monthly", "bank": "مصر"})
    return conn


def test_an_export_comes_back_whole_and_only_once(tmp_path):
    source = ledger(tmp_path / "a.sqlite")
    text = ledger_csv(source, AT)["csv"]
    before = portfolio.portfolio_summary(source, AT)["totals"]
    source.close()
    target = connect(tmp_path / "b.sqlite")
    plan = ledger_import(target, text)
    assert plan["applied"] is False and plan["counts"] == {"lots": 3, "movements": 2, "skipped": 1, "new_assets": 1}
    assert "الشهادات" in plan["skipped"][0]["reason"]
    assert target.execute("SELECT COUNT(*) FROM holdings").fetchone()[0] == 0  # a plan writes nothing
    ledger_import(target, text, apply=True)
    after = portfolio.portfolio_summary(target, AT)
    egp = next(a for g in after["groups"] for a in g["assets"] if a["key"] == "EGP")
    assert egp["quantity"] == 8500 and egp["places"][0]["place"] == "الأهلي" and egp["lots"][0]["note"] == "مرتب"
    usd = next(a for g in after["groups"] for a in g["assets"] if a["key"] == "USD")
    assert usd["quantity"] == 120 and usd["cost_egp"] == pytest.approx(5800)
    fund = next(a for g in after["groups"] for a in g["assets"] if a["kind"] == "fund")
    assert fund["name"] == "صندوق مصر الذهبي" and fund["key"].startswith("custom:")
    # The certificate stayed behind, and with it what it paid into the pounds (worked out from its terms).
    assert after["totals"]["cost"] == pytest.approx(8500 + 5800 + 500) and after["totals"]["cost"] < before["cost"]
    again = ledger_import(target, text, apply=True)
    assert again["counts"]["lots"] == 0 and again["counts"]["movements"] == 0
    assert target.execute("SELECT COUNT(*) FROM holdings").fetchone()[0] == 3
    target.close()


def test_a_file_that_would_go_below_zero_writes_nothing(tmp_path):
    source = ledger(tmp_path / "a.sqlite")
    text = ledger_csv(source, AT)["csv"]
    source.close()
    lines = text.split("\r\n")
    without_pounds = "\r\n".join(line for line in lines if not line.startswith("EGP,"))
    target = connect(tmp_path / "b.sqlite")
    with pytest.raises(LedgerInputError, match="مفيش حاجة اتضافت"):
        ledger_import(target, without_pounds, apply=True)
    assert target.execute("SELECT COUNT(*) FROM holdings").fetchone()[0] == 0
    assert target.execute("SELECT COUNT(*) FROM custom_assets").fetchone()[0] == 0
    target.close()


def test_not_an_export(tmp_path):
    conn = connect(tmp_path / "c.sqlite")
    with pytest.raises(LedgerInputError, match="مش ملف تصدير"):
        ledger_import(conn, "a,b\n1,2\n")
    with pytest.raises(LedgerInputError, match="فاضي"):
        ledger_import(conn, "  ")
    conn.close()


def test_the_cli_reads_a_large_file_on_stdin(tmp_path):
    source = ledger(tmp_path / "a.sqlite")
    text = ledger_csv(source, AT)["csv"]
    source.close()
    env = {"EGX_DB_PATH": str(tmp_path / "d.sqlite"), "EGX_DATA_DIR": str(tmp_path), "PATH": ""}
    proc = subprocess.run([sys.executable, "-m", "egx_mcp.cli", "ledger-import", "-"], input=json.dumps({"csv": text}),
                          capture_output=True, text=True, env=env)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert json.loads(proc.stdout)["counts"]["lots"] == 3
