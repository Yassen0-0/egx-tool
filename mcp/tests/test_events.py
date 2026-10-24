"""Phase 5: what certificates pay into the pounds, a certificate bought with them, dividends, bonus
shares and splits, and what is due soon."""

from datetime import datetime

import pytest

from egx_mcp.errors import LedgerInputError
from egx_mcp.market.calendar import CAIRO
from egx_mcp.store import portfolio, wealth
from egx_mcp.store.activity import ledger_activity
from egx_mcp.store.db import connect

AT = datetime(2026, 10, 15, 20, 0, tzinfo=CAIRO)


@pytest.fixture
def conn(tmp_path, monkeypatch):
    monkeypatch.setenv("EGX_DATA_DIR", str(tmp_path))
    (tmp_path / "manual").mkdir()
    connection = connect(tmp_path / "egx.sqlite")
    yield connection
    connection.close()


def summary(conn):
    return portfolio.portfolio_summary(conn, at=AT)


def asset(conn, key):
    return next(a for g in summary(conn)["groups"] for a in g["assets"] if a["key"] == key)


def certificate(conn, **over):
    terms = {"rate": 0.24, "start_date": "2026-07-15", "maturity_date": "2027-07-15", "payout": "monthly",
             "bank": "الأهلي", **over}
    return portfolio.add_holding(conn, amount=100000, deposit=terms)


def test_a_new_certificate_pays_into_the_pounds(conn):
    lot = certificate(conn)
    egp = asset(conn, "EGP")
    assert egp["quantity"] == pytest.approx(3 * 2000)  # 15 Aug, 15 Sep, 15 Oct at 24% / 12
    paid = [e for e in egp["events"] if e["type"] == "lot"]
    assert [e["date"] for e in paid] == ["2026-08-15", "2026-09-15", "2026-10-15"]
    assert paid[0]["origin"] == lot["symbol"] and paid[0]["note"] == "عائد شهادة الأهلي 24%" and egp["lots"] == []
    cert = asset(conn, lot["symbol"])
    assert cert["value_egp"] == 100000 and cert["deposit"]["settle_to_egp"] is True
    assert cert["deposit"]["next_payout_egp"] == pytest.approx(2000)
    kinds = [(i["kind_label"], i["from"]["key"] if i["from"] else None) for i in ledger_activity(conn, at=AT)["items"]]
    assert kinds[:3] == [("عائد", lot["symbol"])] * 3
    # A return, not new money: the line does not count it as money coming in.
    points = {p["date"]: p for p in wealth.series(conn, AT)}
    assert points["2026-08-15"]["inflow_egp"] == 0 and points["2026-08-15"]["value_egp"] == pytest.approx(102000)


def test_at_maturity_the_principal_comes_back(conn):
    lot = certificate(conn, start_date="2025-10-01", maturity_date="2026-10-01", payout="maturity")
    egp = asset(conn, "EGP")
    assert egp["quantity"] == pytest.approx(100000 * (1 + 0.24 * 365 / 365))
    cert = asset(conn, lot["symbol"])
    assert cert["value_egp"] == 0 and cert["deposit"]["status"] == "matured"


def test_bought_with_the_ledgers_pounds(conn):
    portfolio.add_holding(conn, "EGP", buy_price=1, amount=150000, buy_date="2026-07-01", place="الأهلي")
    lot = certificate(conn, from_egp=True, from_place="الأهلي")
    egp = asset(conn, "EGP")
    assert egp["quantity"] == pytest.approx(50000 + 6000)
    out = next(e for e in egp["events"] if e["type"] == "out")
    assert out["to_asset"] == lot["symbol"] and out["other"]["name"] == "شهادة الأهلي 24%" and out["realized"] == 0
    assert summary(conn)["totals"]["value"] == pytest.approx(156000)
    points = {p["date"]: p for p in wealth.series(conn, AT)}
    assert points["2026-07-15"]["inflow_egp"] == 0  # pounds into a certificate: no new money
    with pytest.raises(LedgerInputError, match="تحويل الشرا"):
        portfolio.remove_holding(conn, lot["id"])
    with pytest.raises(LedgerInputError, match="سجّل الجنيه"):
        certificate(conn, from_egp=True)  # only 56,000 pounds left


def test_dividends_are_a_stocks_return(conn):
    portfolio.add_holding(conn, "COMI", buy_price=80, quantity=100, buy_date="2026-01-01")
    portfolio.add_dividend(conn, "COMI", 250, date="2026-04-01")
    portfolio.add_dividend(conn, "COMI", 300, date="2026-09-01", place="Thndr")
    assert asset(conn, "COMI")["dividends_egp"] == pytest.approx(550)
    egp = asset(conn, "EGP")
    assert egp["quantity"] == 550 and egp["lots"][0]["origin"] == "dividend:COMI" and egp["lots"][0]["note"] == "توزيعات البنك التجاري الدولي"
    item = next(i for i in ledger_activity(conn, at=AT)["items"] if i["kind_label"] == "توزيعات")
    assert item["from"]["key"] == "COMI"
    assert {p["date"]: p for p in wealth.series(conn, AT)}["2026-04-01"]["inflow_egp"] == 0
    with pytest.raises(LedgerInputError, match="للأسهم والصناديق"):
        portfolio.add_dividend(conn, "USD", 1)


def test_bonus_shares_and_a_split_keep_the_cost(conn):
    portfolio.add_holding(conn, "COMI", buy_price=80, quantity=100, buy_date="2026-01-01")
    bonus = portfolio.add_corporate_action(conn, "COMI", "bonus", date="2026-05-01", quantity=25)
    portfolio.add_corporate_action(conn, "COMI", "split", date="2026-06-01", ratio=2)
    comi = asset(conn, "COMI")
    assert comi["quantity"] == 250 and comi["cost_egp"] == pytest.approx(8000)
    assert [(e["type"], e["quantity"]) for e in comi["events"]] == [("lot", 100), ("action", 25), ("action", 125)]
    portfolio.add_movement(conn, "transfer", "COMI", 250, "EGP", 12000, date="2026-07-01")
    with pytest.raises(LedgerInputError, match="بالسالب"):
        portfolio.remove_corporate_action(conn, bonus["id"])  # the sale needs those shares
    with pytest.raises(LedgerInputError, match="مكانش عندك"):
        portfolio.add_corporate_action(conn, "COMI", "bonus", date="2025-01-01", quantity=5)
    with pytest.raises(LedgerInputError, match="تقسيم"):
        portfolio.add_corporate_action(conn, "COMI", "split", date="2026-06-02", ratio=None)


def test_what_is_due_soon(conn):
    certificate(conn)
    portfolio.add_debt(conn, "قرض", 10000, start_date="2026-09-01", installment_egp=1000, due_day=20)
    soon = summary(conn)["upcoming"]
    assert [(u["date"], u["kind"]) for u in soon] == [("2026-10-20", "installment"), ("2026-11-15", "payout")]
    assert soon[1]["amount_egp"] == pytest.approx(2000) and soon[0]["label"] == "قسط قرض"
    assert [u["in_days"] for u in soon] == [5, 31]
