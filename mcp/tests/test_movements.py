"""«الحركات»: money moving between assets. A transfer is a sale and a purchase at one moment: what
left realises its gain, what arrived costs what it was worth, so nothing is counted twice."""

from datetime import datetime

import pytest

from egx_mcp import cli
from egx_mcp.errors import LedgerInputError
from egx_mcp.market.calendar import CAIRO
from egx_mcp.store import movements, portfolio
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


def spy(conn, price=700):
    """A fund in dollars, by name, with the user's own price."""
    lot = portfolio.add_holding(conn, None, buy_price=price, quantity=0.0001, buy_date="2026-01-01", cost_egp=1,
                                custom={"kind": "fund", "name": "SPY", "currency": "USD", "price": price})
    portfolio.remove_holding(conn, lot["id"])
    return lot["symbol"]


def test_pounds_to_dollars_to_a_fund(conn):
    # The user's example: 1000 EGP from the bank → 20 USD → units of an S&P 500 fund.
    portfolio.add_holding(conn, "EGP", buy_price=1, amount=1000, buy_date="2026-10-01")
    portfolio.set_price(conn, "USD", 49, day="2026-10-01")
    move = portfolio.add_movement(conn, "transfer", "EGP", 1000, "USD", 20, date="2026-10-02")
    assert move["kind"] == "transfer" and move["value_egp"] is None
    usd = asset(conn, "USD")
    assert usd["quantity"] == 20 and usd["cost_egp"] == pytest.approx(1000)  # 50 a dollar, not the 49 market
    [event] = usd["events"]
    assert event["type"] == "in" and event["other"]["key"] == "EGP" and event["balance"] == 20
    assert event["market_value_egp"] == pytest.approx(980)  # the 20 the bank kept shows as a gap
    assert asset(conn, "EGP")["group"] == "closed" and asset(conn, "EGP")["value_egp"] == 0

    fund = spy(conn)
    portfolio.set_price(conn, "USD", 51, day="2026-10-10")
    portfolio.add_movement(conn, "transfer", "USD", 20, fund, 1.5, date="2026-10-10")
    usd, held = asset(conn, "USD"), asset(conn, fund)
    assert usd["realized_egp"] == pytest.approx(20 * 51 - 1000)  # the dollar's own gain, realised
    assert held["cost_egp"] == pytest.approx(1020) and held["group"] == "funds"
    totals = summary(conn)["totals"]
    assert totals["realized"] == pytest.approx(20) and totals["assets"] == 1
    assert [e["type"] for e in usd["events"]] == ["in", "out"] and usd["events"][-1]["balance"] == 0


def test_part_of_an_asset_leaves_at_its_average_cost(conn):
    portfolio.add_holding(conn, "USD", buy_price=40, quantity=100, buy_date="2026-01-01")
    portfolio.add_holding(conn, "USD", buy_price=50, quantity=100, buy_date="2026-02-01")
    portfolio.add_movement(conn, "transfer", "USD", 50, "EGP", 2400, date="2026-03-01")  # sold 50 at 48
    usd = asset(conn, "USD")
    assert usd["quantity"] == 150 and usd["cost_egp"] == pytest.approx(9000 * 150 / 200)
    assert usd["realized_egp"] == pytest.approx(2400 - 9000 * 50 / 200)
    egp = asset(conn, "EGP")
    assert egp["quantity"] == 2400 and egp["cost_egp"] == pytest.approx(2400) and egp["growth"] == pytest.approx(0)


def test_an_expense_leaves_the_ledger_and_realises_nothing(conn):
    portfolio.add_holding(conn, "EGP", buy_price=1, amount=10000, buy_date="2026-10-01")
    portfolio.add_movement(conn, "expense", "EGP", 2500, date="2026-10-05", note="إيجار")
    egp = asset(conn, "EGP")
    assert egp["quantity"] == 7500 and egp["realized_egp"] == 0
    out = egp["events"][-1]
    assert out["kind"] == "expense" and out["value_egp"] == 2500 and out["other"] is None and out["note"] == "إيجار"
    with pytest.raises(LedgerInputError, match="مالوش أصل"):
        portfolio.add_movement(conn, "expense", "EGP", 1, "USD", 1)


def test_more_than_was_held_is_refused_or_topped_up(conn):
    portfolio.add_holding(conn, "EGP", buy_price=1, amount=600, buy_date="2026-10-01")
    with pytest.raises(LedgerInputError, match="ناقص 400.*سجّل الفرق كدخل"):
        portfolio.add_movement(conn, "transfer", "EGP", 1000, "USD", 20, date="2026-10-02")
    assert conn.execute("SELECT COUNT(*) FROM movements").fetchone()[0] == 0
    portfolio.add_movement(conn, "transfer", "EGP", 1000, "USD", 20, date="2026-10-02", top_up=True)
    lots = asset(conn, "EGP")["lots"]
    assert [lot["quantity"] for lot in lots] == [600, 400] and lots[1]["buy_date"] == "2026-10-02"
    assert asset(conn, "USD")["cost_egp"] == pytest.approx(1000)


def test_a_top_up_needs_a_price_on_that_day(conn):
    portfolio.add_holding(conn, "USD", buy_price=50, quantity=10, buy_date="2026-10-01")
    with pytest.raises(LedgerInputError, match="مفيش سعر معروف"):
        portfolio.add_movement(conn, "transfer", "USD", 20, "EGP", 1000, date="2026-10-02", top_up=True)
    portfolio.set_price(conn, "USD", 50, day="2026-10-02")
    portfolio.add_movement(conn, "transfer", "USD", 20, "EGP", 1000, date="2026-10-02", top_up=True)
    assert asset(conn, "USD")["group"] == "closed"


def test_a_purchase_a_movement_needs_cannot_go(conn):
    lot = portfolio.add_holding(conn, "EGP", buy_price=1, amount=1000, buy_date="2026-10-01")
    move = portfolio.add_movement(conn, "transfer", "EGP", 1000, "USD", 20, date="2026-10-02")
    with pytest.raises(LedgerInputError, match="بالسالب"):
        portfolio.remove_holding(conn, lot["id"])
    with pytest.raises(LedgerInputError, match="بالسالب"):
        portfolio.update_holding(conn, lot["id"], buy_date="2026-10-03")  # after the transfer
    with pytest.raises(LedgerInputError, match="بالسالب"):
        portfolio.update_holding(conn, lot["id"], quantity=500)
    with pytest.raises(LedgerInputError, match="تحويلات"):
        portfolio.remove_asset(conn, "USD")
    assert portfolio.get_holding(conn, lot["id"])["quantity"] == 1000
    portfolio.remove_movement(conn, move["id"])
    portfolio.remove_holding(conn, lot["id"])
    assert summary(conn)["groups"] == []


def test_removing_an_earlier_transfer_cannot_strand_a_later_one(conn):
    portfolio.add_holding(conn, "EGP", buy_price=1, amount=1000, buy_date="2026-10-01")
    first = portfolio.add_movement(conn, "transfer", "EGP", 1000, "USD", 20, date="2026-10-02")
    portfolio.add_movement(conn, "transfer", "USD", 20, "EGP", 1000, date="2026-10-03")
    with pytest.raises(LedgerInputError, match="ناقص 20"):
        portfolio.remove_movement(conn, first["id"])
    with pytest.raises(LedgerInputError, match="بالسالب"):
        portfolio.update_movement(conn, first["id"], to_quantity=10)
    edited = portfolio.update_movement(conn, first["id"], to_quantity=25, note="سعر البنك")
    assert edited["to_quantity"] == 25 and asset(conn, "USD")["quantity"] == 5


def test_the_value_between_two_foreign_assets(conn):
    portfolio.add_holding(conn, "USD", buy_price=50, quantity=100, buy_date="2026-10-01")
    fund = spy(conn)
    # No dollar rate known that day: the value falls back on the cost that left.
    portfolio.add_movement(conn, "transfer", "USD", 70, fund, 0.1, date="2026-10-02")
    held = asset(conn, fund)
    assert held["cost_egp"] == pytest.approx(3500) and asset(conn, "USD")["realized_egp"] == pytest.approx(0)
    # The user's own EGP value wins over any price.
    portfolio.add_movement(conn, "transfer", "USD", 30, fund, 0.05, date="2026-10-03", value_egp=1560)
    assert asset(conn, fund)["cost_egp"] == pytest.approx(3500 + 1560)
    assert asset(conn, "USD")["realized_egp"] == pytest.approx(1560 - 1500)


def test_inputs(conn):
    portfolio.add_holding(conn, "EGP", buy_price=1, amount=1000)
    for args, message in ((("swap", "EGP", 1, "USD", 1), "تحويل أو خروج"), (("transfer", "EGP", 1, "EGP", 1), "لأصل تاني"),
                          (("transfer", "EGP", 0, "USD", 1), "اللي خرجت"), (("transfer", "EGP", 1, None, 1), "راحت له"),
                          (("transfer", "NOPE", 1, "USD", 1), "مش في الفهرس"), (("transfer", "deposit:1", 1, "EGP", 1), "الشهادات")):
        with pytest.raises(LedgerInputError, match=message):
            portfolio.add_movement(conn, *args)


def test_replay_orders_by_day_purchases_first():
    lots = [{"id": 2, "symbol": "EGP", "quantity": 100, "cost_egp": 100, "buy_date": None, "created_at": "2026-10-02T09:00:00+00:00"}]
    moves = [{"id": 1, "date": "2026-10-02", "kind": "expense", "from_asset": "EGP", "from_quantity": 100,
              "to_asset": None, "to_quantity": None, "value_egp": None, "note": None}]
    book = movements.replay(lots, moves, lambda *_: None)
    assert book["short"] == [] and book["assets"]["EGP"]["quantity"] == 0


def test_the_cli_and_the_assistant_share_the_movement_commands(tmp_path, monkeypatch):
    monkeypatch.setenv("EGX_DB_PATH", str(tmp_path / "cli.sqlite"))
    cli.run("portfolio-add", '{"asset": "EGP", "buy_price": 1, "amount": 1000}')
    move = cli.run("movement-add", '{"from_asset": "EGP", "from_quantity": "1000", "to_asset": "USD", "to_quantity": 20,'
                                   ' "value_egp": "", "top_up": false}')
    assert cli.run("movement-update", f'{{"movement_id": {move["id"]}, "note": "البنك"}}')["note"] == "البنك"
    assert cli.run("movement-remove", f'{{"movement_id": {move["id"]}}}')["removed"]["id"] == move["id"]


def test_the_whole_ledgers_activity_and_a_months_totals(conn):
    from egx_mcp.store.activity import ledger_activity
    portfolio.add_holding(conn, "EGP", buy_price=1, amount=10000, buy_date="2026-09-28", note="مرتب")
    portfolio.add_holding(conn, "EGP", buy_price=1, amount=5000, buy_date="2026-10-01")
    portfolio.add_movement(conn, "transfer", "EGP", 1000, "USD", 20, date="2026-10-02")
    portfolio.add_movement(conn, "expense", "EGP", 2500, date="2026-10-05", note="إيجار")
    every = ledger_activity(conn, at=AT)
    assert every["months"] == ["2026-10", "2026-09"]
    assert [i["kind"] for i in every["items"]] == ["expense", "transfer", "income", "income"]
    transfer = every["items"][1]
    assert transfer["from"]["key"] == "EGP" and transfer["to"]["key"] == "USD" and transfer["to_quantity"] == 20
    october = ledger_activity(conn, month="2026-10", at=AT)["totals"]
    assert october == {"income_egp": 5000, "expense_egp": 2500, "transfer_egp": 1000, "repay_egp": 0, "realized_egp": 0,
                       "count": 3}
    assert [i["kind"] for i in ledger_activity(conn, kind="income", at=AT)["items"]] == ["income", "income"]
    assert len(ledger_activity(conn, asset="USD", at=AT)["items"]) == 1
    with pytest.raises(LedgerInputError, match="سنة-شهر"):
        ledger_activity(conn, month="10/2026")
