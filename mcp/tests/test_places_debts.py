"""Where the money is (places), moving it between places, and what the user owes (debts)."""

from datetime import datetime

import pytest

from egx_mcp import cli
from egx_mcp.errors import LedgerInputError
from egx_mcp.market.calendar import CAIRO
from egx_mcp.store import portfolio
from egx_mcp.store.db import connect

AT = datetime(2026, 10, 15, 8, 0, tzinfo=CAIRO)


@pytest.fixture
def conn(tmp_path):
    connection = connect(tmp_path / "egx.sqlite")
    yield connection
    connection.close()


def summary(conn):
    return portfolio.portfolio_summary(conn, at=AT)


def asset(conn, key):
    return next(a for g in summary(conn)["groups"] for a in g["assets"] if a["key"] == key)


def test_each_place_holds_its_part(conn):
    portfolio.add_holding(conn, "USD", buy_price=50, quantity=600, buy_date="2026-10-01", place="البنك الأهلي")
    portfolio.add_holding(conn, "USD", buy_price=50, quantity=400, buy_date="2026-10-02", place=" Thndr ")
    usd = asset(conn, "USD")
    assert usd["places"] == [{"place": "البنك الأهلي", "quantity": 600}, {"place": "Thndr", "quantity": 400}]
    assert summary(conn)["totals"]["places"] == ["Thndr", "البنك الأهلي"]
    assert usd["lots"][1]["place"] == "Thndr"


def test_moving_an_asset_between_places_sells_nothing(conn):
    portfolio.add_holding(conn, "USD", buy_price=50, quantity=600, buy_date="2026-10-01", place="الأهلي")
    move = portfolio.add_movement(conn, "transfer", "USD", 100, "USD", 99, date="2026-10-03",
                                  from_place="الأهلي", to_place="Thndr")  # a dollar of fees on the way
    usd = asset(conn, "USD")
    assert usd["quantity"] == 599 and usd["cost_egp"] == pytest.approx(30000) and usd["realized_egp"] == 0
    assert usd["places"] == [{"place": "الأهلي", "quantity": 500}, {"place": "Thndr", "quantity": 99}]
    assert move["from_place"] == "الأهلي" and move["to_place"] == "Thndr"
    with pytest.raises(LedgerInputError, match="مكان تاني"):
        portfolio.add_movement(conn, "transfer", "USD", 1, "USD", 1, from_place="Thndr", to_place="Thndr")


def test_a_named_place_cannot_give_more_than_it_holds(conn):
    portfolio.add_holding(conn, "EGP", buy_price=1, amount=1000, buy_date="2026-10-01", place="الأهلي")
    portfolio.add_holding(conn, "EGP", buy_price=1, amount=1000, buy_date="2026-10-01", place="كاش")
    with pytest.raises(LedgerInputError, match="رصيد الجنيه المصري في كاش .* ناقص 500"):
        portfolio.add_movement(conn, "expense", "EGP", 1500, date="2026-10-02", from_place="كاش")
    portfolio.add_movement(conn, "expense", "EGP", 1500, date="2026-10-02", from_place="كاش", top_up=True)
    egp = asset(conn, "EGP")
    assert egp["places"] == [{"place": "الأهلي", "quantity": 1000}]
    # No place named: what leaves comes from every place in proportion.
    portfolio.add_holding(conn, "EGP", buy_price=1, amount=1000, buy_date="2026-10-03", place="كاش")
    portfolio.add_movement(conn, "expense", "EGP", 1000, date="2026-10-04")
    assert asset(conn, "EGP")["places"] == [{"place": "الأهلي", "quantity": 500}, {"place": "كاش", "quantity": 500}]


def test_a_debt_paid_down_and_what_the_user_is_worth(conn):
    debt = portfolio.add_debt(conn, "قرض العربية", 50000, start_date="2026-09-01", installment_egp=2500, due_day=5,
                              received_into_egp=True, place="الأهلي")
    totals = summary(conn)["totals"]
    assert totals["value"] == pytest.approx(50000) and totals["debts"] == pytest.approx(50000)
    assert totals["net_worth"] == pytest.approx(0)
    portfolio.add_movement(conn, "repay", "EGP", 2500, f"debt:{debt['id']}", date="2026-10-05")
    portfolio.add_movement(conn, "repay", "EGP", 3000, f"debt:{debt['id']}", 2600, date="2026-10-06")  # 400 interest
    [row] = summary(conn)["debts"]
    assert row["paid_egp"] == pytest.approx(5100) and row["remaining_egp"] == pytest.approx(44900)
    assert row["next_due_date"] == "2026-11-05" and [p["paid_egp"] for p in row["payments"]] == [2500, 2600]
    totals = summary(conn)["totals"]
    assert totals["net_worth"] == pytest.approx(44500 - 44900)  # the 400 of interest is gone
    egp = asset(conn, "EGP")
    assert egp["events"][-1]["kind"] == "repay" and egp["events"][-1]["to_asset"] == f"debt:{debt['id']}"


def test_a_debt_never_goes_below_zero_and_keeps_its_payments(conn):
    portfolio.add_holding(conn, "EGP", buy_price=1, amount=10000, buy_date="2026-10-01")
    debt = portfolio.add_debt(conn, "سلفة", 1000, start_date="2026-10-01")
    with pytest.raises(LedgerInputError, match="أكبر من الباقي"):
        portfolio.add_movement(conn, "repay", "EGP", 1200, f"debt:{debt['id']}", date="2026-10-02")
    move = portfolio.add_movement(conn, "repay", "EGP", 1000, f"debt:{debt['id']}", date="2026-10-02")
    assert summary(conn)["debts"][0]["settled"] is True and summary(conn)["debts"][0]["next_due_date"] is None
    with pytest.raises(LedgerInputError, match="أكبر من الباقي"):
        portfolio.update_debt(conn, debt["id"], principal=500)
    with pytest.raises(LedgerInputError, match="سدادات"):
        portfolio.remove_debt(conn, debt["id"])
    portfolio.remove_movement(conn, move["id"])
    portfolio.remove_debt(conn, debt["id"])
    assert summary(conn)["debts"] == []
    with pytest.raises(LedgerInputError, match="مش موجود"):
        portfolio.add_movement(conn, "repay", "EGP", 1, "debt:99")


def test_debt_inputs_and_commands(tmp_path, monkeypatch):
    monkeypatch.setenv("EGX_DB_PATH", str(tmp_path / "cli.sqlite"))
    for args, message in (({"name": "", "principal": 1}, "اسم الدين"), ({"name": "x", "principal": 0}, "أكبر من صفر"),
                          ({"name": "x", "principal": 1, "due_day": 31}, "من 1 لـ 28")):
        with pytest.raises(LedgerInputError, match=message):
            cli.run("debt-add", __import__("json").dumps(args))
    debt = cli.run("debt-add", '{"name": "كارت", "principal": 5000, "start_date": "2026-10-01"}')
    assert cli.run("debt-update", f'{{"debt_id": {debt["id"]}, "installment_egp": 500}}')["installment_egp"] == 500
    assert cli.run("debt-remove", f'{{"debt_id": {debt["id"]}}}')["removed"]["name"] == "كارت"


def test_the_daily_line_is_net_of_what_is_owed(conn, tmp_path, monkeypatch):
    from egx_mcp.store import wealth
    monkeypatch.setenv("EGX_DATA_DIR", str(tmp_path))
    portfolio.add_holding(conn, "EGP", buy_price=1, amount=20000, buy_date="2026-09-01")
    debt = portfolio.add_debt(conn, "قرض", 10000, start_date="2026-10-01", received_into_egp=True)
    portfolio.add_movement(conn, "repay", "EGP", 1000, f"debt:{debt['id']}", date="2026-10-10")
    points = {p["date"]: p for p in wealth.series(conn, AT)}
    assert points["2026-09-30"]["value_egp"] == pytest.approx(20000)
    assert points["2026-10-05"]["value_egp"] == pytest.approx(20000)  # 30,000 in pounds, 10,000 owed
    assert points["2026-10-12"]["value_egp"] == pytest.approx(20000)
    assert points["2026-10-01"]["inflow_egp"] == pytest.approx(0)  # borrowed pounds in, the debt out
