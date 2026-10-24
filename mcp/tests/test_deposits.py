"""«شهادات وودائع»: a certificate is one holding plus its terms; its value comes from the terms and
today's date (interest paid out leaves it, interest paid at maturity stays in it)."""

import sqlite3
from datetime import date, datetime

import pytest

from egx_mcp import cli
from egx_mcp.errors import LedgerInputError
from egx_mcp.market.calendar import CAIRO
from egx_mcp.store import deposits, portfolio
from egx_mcp.store.db import SCHEMA_VERSION, connect

AT = datetime(2026, 10, 15, 8, 0, tzinfo=CAIRO)


@pytest.fixture
def conn(tmp_path):
    connection = connect(tmp_path / "egx.sqlite")
    yield connection
    connection.close()


def terms(**over):
    """A certificate as one recorded before it could settle into EGP (the tests below the line set it)."""
    return {"rate": 0.27, "start_date": "2025-10-15", "maturity_date": "2028-10-15", "payout": "monthly",
            "bank": "البنك الأهلي", "settle_to_egp": False, **over}


def add(conn, amount=100000, **over):
    return portfolio.add_holding(conn, amount=amount, deposit=terms(**over))


def asset(conn, key):
    summary = portfolio.portfolio_summary(conn, at=AT)
    return next(a for g in summary["groups"] for a in g["assets"] if a["key"] == key)


def test_old_database_gets_the_deposits_table(tmp_path):
    path = tmp_path / "egx.sqlite"
    first = connect(path)
    portfolio.add_holding(first, "USD", buy_price=48, quantity=100)
    first.execute("DROP TABLE deposits")
    first.execute("PRAGMA user_version = 4")
    first.commit()
    first.close()
    conn = connect(path)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION >= 5
    assert conn.execute("SELECT COUNT(*) FROM holdings").fetchone()[0] == 1
    assert [r["name"] for r in conn.execute("PRAGMA table_info(deposits)")] == [
        "holding_id", "rate", "start_date", "maturity_date", "payout", "bank", "settle_to_egp"]
    assert len(list((tmp_path / "backups").glob(f"egx-*-before-v{SCHEMA_VERSION}.sqlite"))) == 1
    lot = add(conn)
    assert lot["symbol"] == f"deposit:{lot['id']}"
    conn.close()


def test_a_deposit_is_a_holding_of_its_principal(conn):
    lot = add(conn, 250000)
    assert lot["kind"] == "deposit" and lot["quantity"] == 250000 and lot["buy_price"] == 1
    assert lot["currency"] == "EGP" and lot["cost_egp"] == 250000 and lot["buy_date"] == "2025-10-15"
    row = conn.execute("SELECT * FROM deposits WHERE holding_id = ?", (lot["id"],)).fetchone()
    assert (row["rate"], row["payout"], row["bank"]) == (0.27, "monthly", "البنك الأهلي")


def test_monthly_payout_keeps_the_value_at_the_principal(conn):
    key = add(conn)["symbol"]
    a = asset(conn, key)
    assert a["group"] == "deposits" and a["kind_label"] == "شهادة/وديعة" and a["name"] == "شهادة البنك الأهلي 27%"
    assert a["value_egp"] == 100000 and a["cost_egp"] == 100000 and a["growth"] == 0
    assert a["price"] is None and a["today_change"] is None
    d = a["deposit"]
    assert d["status"] == "active" and d["interest_per_year"] == pytest.approx(27000)
    assert d["interest_to_date"] == pytest.approx(27000 * 365 / 365) and d["days_left"] == 2 * 365 + 1
    assert d["next_payout_date"] == "2026-10-15" and a["next_payout_date"] == "2026-10-15"
    assert a["maturity_date"] == "2028-10-15" and a["interest_per_year"] == pytest.approx(27000)


def test_maturity_payout_adds_the_simple_interest_accrued(conn):
    key = add(conn, 100000, payout="maturity", start_date="2026-04-15", maturity_date="2028-04-15")["symbol"]
    a = asset(conn, key)
    days = (date(2026, 10, 15) - date(2026, 4, 15)).days
    assert a["value_egp"] == pytest.approx(100000 + 27000 * days / 365)
    assert a["growth"] == pytest.approx(27000 * days / 365 / 100000) and a["growth"] > 0
    assert a["deposit"]["next_payout_date"] == "2028-04-15" and a["deposit"]["status"] == "active"
    # It enters the ledger's total and growth like any priced asset.
    totals = portfolio.portfolio_summary(conn, at=AT)["totals"]
    assert totals["value"] == pytest.approx(a["value_egp"]) and totals["growth"] == pytest.approx(a["growth"])


def test_matured_deposit_shows_as_matured(conn):
    periodic = add(conn, 50000, start_date="2024-10-01", maturity_date="2026-10-01")["symbol"]
    at_end = add(conn, 50000, payout="maturity", start_date="2024-10-01", maturity_date="2026-10-01")["symbol"]
    a, b = asset(conn, periodic), asset(conn, at_end)
    assert a["deposit"]["status"] == "matured" and a["deposit"]["next_payout_date"] is None
    assert a["deposit"]["days_left"] is None and a["value_egp"] == 50000
    # The whole term's interest, not a day more.
    days = (date(2026, 10, 1) - date(2024, 10, 1)).days
    assert b["deposit"]["status"] == "matured" and b["value_egp"] == pytest.approx(50000 + 13500 * days / 365)
    assert b["deposit"]["interest_to_date"] == pytest.approx(13500 * days / 365)


def test_not_started_yet_has_no_interest(conn):
    key = add(conn, payout="maturity", start_date="2026-11-01", maturity_date="2027-11-01")["symbol"]
    a = asset(conn, key)
    assert a["value_egp"] == 100000 and a["deposit"]["interest_to_date"] == 0
    assert a["deposit"]["next_payout_date"] == "2027-11-01"


def test_next_payout_dates_follow_the_start_day():
    t = terms(start_date="2026-01-31", maturity_date="2027-01-31", payout="monthly")
    assert deposits.next_payout(t, date(2026, 2, 1)).isoformat() == "2026-02-28"
    assert deposits.next_payout(t, date(2026, 3, 1)).isoformat() == "2026-03-31"
    assert deposits.next_payout(terms(payout="quarterly", start_date="2026-08-20", maturity_date="2027-08-20"),
                                date(2026, 10, 15)).isoformat() == "2026-11-20"
    assert deposits.next_payout(terms(payout="annual", start_date="2025-03-10", maturity_date="2028-03-10"),
                                date(2026, 10, 15)).isoformat() == "2027-03-10"
    # A part period at the end is paid on the maturity date.
    short = terms(payout="quarterly", start_date="2026-01-01", maturity_date="2026-11-15")
    assert deposits.next_payout(short, date(2026, 10, 15)).isoformat() == "2026-11-15"
    assert deposits.next_payout(short, date(2026, 11, 15)) is None


def test_the_group_comes_fifth_and_only_when_there_are_deposits(conn):
    portfolio.add_holding(conn, "USD", buy_price=48, quantity=100)
    assert [g["group"] for g in portfolio.portfolio_summary(conn, at=AT)["groups"]] == ["currencies"]
    add(conn)
    portfolio.add_holding(conn, None, buy_price=10, quantity=100, custom={"kind": "fund", "name": "صندوق"})
    groups = portfolio.portfolio_summary(conn, at=AT)["groups"]
    assert [(g["group"], g["label"]) for g in groups][-2:] == [("funds", "صناديق"), ("deposits", "شهادات وودائع")]


def test_removing_the_holding_removes_its_terms(conn):
    lot = add(conn)
    portfolio.remove_holding(conn, lot["id"])
    assert conn.execute("SELECT COUNT(*) FROM deposits").fetchone()[0] == 0
    other = add(conn)
    portfolio.remove_asset(conn, other["symbol"])
    assert conn.execute("SELECT COUNT(*) FROM deposits").fetchone()[0] == 0


def test_a_deposit_has_no_price_to_type(conn):
    key = add(conn)["symbol"]
    with pytest.raises(LedgerInputError, match="مفيش سعر"):
        portfolio.set_price(conn, key, 1.2)


def test_the_principal_can_be_edited_and_the_price_stays_one(conn):
    lot = add(conn)
    edited = portfolio.update_holding(conn, lot["id"], quantity=120000, buy_price=5)
    assert edited["buy_price"] == 1 and edited["cost_egp"] == 120000
    assert asset(conn, lot["symbol"])["value_egp"] == 120000


@pytest.mark.parametrize("body, message", [
    ({"rate": 27}, "ككسر"),
    ({"rate": 0}, "ككسر"),
    ({"rate": None}, "ككسر"),
    ({"start_date": None}, "تاريخ بداية"),
    ({"maturity_date": ""}, "تاريخ استحقاق"),
    ({"start_date": "15/10/2025"}, "سنة-شهر-يوم"),
    ({"maturity_date": "2025-10-15"}, "بعد تاريخ البداية"),
    ({"maturity_date": "2099-10-15"}, "أطول"),
    ({"payout": "weekly"}, "طريقة صرف"),
    ({"payout": None}, "طريقة صرف"),
])
def test_bad_terms_are_rejected_in_arabic_and_write_nothing(conn, body, message):
    with pytest.raises(LedgerInputError, match=message):
        portfolio.add_holding(conn, amount=1000, deposit=terms(**body))
    assert conn.execute("SELECT COUNT(*) FROM holdings").fetchone()[0] == 0


def test_the_principal_and_the_other_fields_are_checked(conn):
    with pytest.raises(LedgerInputError, match="مبلغ الشهادة"):
        portfolio.add_holding(conn, amount=0, deposit=terms())
    with pytest.raises(LedgerInputError, match="مرة واحدة"):
        portfolio.add_holding(conn, deposit=terms())
    with pytest.raises(LedgerInputError, match="بالجنيه"):
        portfolio.add_holding(conn, amount=1000, currency="USD", deposit=terms())
    with pytest.raises(LedgerInputError, match="لوحدها"):
        portfolio.add_holding(conn, "USD", amount=1000, deposit=terms())
    assert conn.execute("SELECT COUNT(*) FROM holdings").fetchone()[0] == 0


def test_the_cli_takes_the_deposit_like_the_screen_sends_it(tmp_path, monkeypatch):
    monkeypatch.setenv("EGX_DB_PATH", str(tmp_path / "egx.sqlite"))
    monkeypatch.setenv("EGX_DATA_DIR", str(tmp_path))
    import json
    lot = cli.run("portfolio-add", json.dumps({"amount": 5000, "buy_price": 1, "currency": "EGP", "buy_date": None,
                                                "note": "", "deposit": terms(payout="quarterly")}))
    assert lot["symbol"].startswith("deposit:") and lot["quantity"] == 5000
    with sqlite3.connect(tmp_path / "egx.sqlite") as db:
        assert db.execute("SELECT payout FROM deposits").fetchone()[0] == "quarterly"


def test_editing_the_date_moves_the_start_and_the_accrued_interest(conn):
    lot = add(conn, 100000, payout="maturity")
    portfolio.update_holding(conn, lot["id"], buy_date="2026-04-15")
    row = asset(conn, lot["symbol"])
    assert row["deposit"]["start_date"] == "2026-04-15"
    assert row["value_egp"] == pytest.approx(100000 * (1 + 0.27 * 183 / 365))
    assert portfolio.get_holding(conn, lot["id"])["buy_date"] == "2026-04-15"


def test_editing_the_terms_renames_the_certificate(conn):
    lot = add(conn)
    portfolio.update_holding(conn, lot["id"], deposit={"rate": 0.235, "bank": "بنك مصر", "payout": "quarterly",
                                                       "maturity_date": "2029-10-15"})
    row = asset(conn, lot["symbol"])
    assert row["name"] == "شهادة بنك مصر 23.5%"
    assert row["deposit"]["payout"] == "quarterly" and row["maturity_date"] == "2029-10-15"
    assert row["interest_per_year"] == pytest.approx(23500)


def test_a_rejected_term_change_writes_nothing(conn):
    lot = add(conn)
    with pytest.raises(LedgerInputError, match="بعد تاريخ البداية"):
        portfolio.update_holding(conn, lot["id"], quantity=5, deposit={"maturity_date": "2025-01-01"})
    with pytest.raises(LedgerInputError, match="الكمية"):
        portfolio.update_holding(conn, lot["id"], quantity=-1, deposit={"rate": 0.3})
    conn.rollback()
    assert asset(conn, lot["symbol"])["deposit"]["rate"] == 0.27
    assert portfolio.get_holding(conn, lot["id"])["quantity"] == 100000


def test_terms_are_for_deposits_only(conn):
    lot = portfolio.add_holding(conn, "USD", buy_price=48, quantity=10)
    with pytest.raises(LedgerInputError, match="للشهادات"):
        portfolio.update_holding(conn, lot["id"], deposit={"rate": 0.2})
