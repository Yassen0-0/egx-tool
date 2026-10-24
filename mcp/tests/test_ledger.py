"""«السجل»: costs fixed in EGP at purchase, values from the latest price, growth on known numbers,
fund components shown and never summed, unpriced assets left out of the total."""

from datetime import datetime

import pytest

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


def asset(conn, key):
    summary = portfolio.portfolio_summary(conn, at=AT)
    return next(a for g in summary["groups"] for a in g["assets"] if a["key"] == key)


def test_dollar_bought_in_egp_grows_with_the_rate(conn):
    portfolio.add_holding(conn, "USD", buy_price=30.9, quantity=1000, buy_date="2023-03-01")
    portfolio.set_price(conn, "USD", 48.5, day="2026-10-15")
    usd = asset(conn, "USD")
    assert usd["cost_egp"] == pytest.approx(30900) and usd["value_egp"] == pytest.approx(48500)
    assert usd["growth"] == pytest.approx(48500 / 30900 - 1) and usd["group"] == "currencies"


def test_bitcoin_cost_uses_the_rate_of_the_buy_day_and_keeps_it(conn):
    portfolio.set_price(conn, "USD", 47.0, day="2026-09-01")
    portfolio.set_price(conn, "USD", 48.0, day="2026-10-15")
    lot = portfolio.add_holding(conn, "BTC", buy_price=60000, quantity=0.01, buy_date="2026-09-10")
    assert lot["currency"] == "USD" and lot["fx_egp"] == 47.0 and lot["cost_egp"] == pytest.approx(28200)
    portfolio.set_price(conn, "BTC", 70000, "USD", day="2026-10-15")
    btc = asset(conn, "BTC")
    assert btc["value_egp"] == pytest.approx(0.01 * 70000 * 48) and btc["price_currency"] == "USD"
    # Editing the buy price recomputes the cost with the saved rate, not today's.
    edited = portfolio.update_holding(conn, lot["id"], buy_price=62000)
    assert edited["cost_egp"] == pytest.approx(0.01 * 62000 * 47)


def test_egp_paid_sets_the_rate_and_no_known_rate_asks_for_it(conn):
    with pytest.raises(LedgerInputError, match="بالجنيه"):
        portfolio.add_holding(conn, "BTC", buy_price=60000, quantity=0.01)
    lot = portfolio.add_holding(conn, "BTC", buy_price=60000, quantity=0.01, cost_egp=31000)
    assert lot["cost_egp"] == pytest.approx(31000) and lot["fx_egp"] == pytest.approx(31000 / 600)


def test_lots_of_one_asset_make_one_row(conn):
    portfolio.add_holding(conn, "USD", buy_price=30, quantity=100)
    portfolio.add_holding(conn, "USD", buy_price=50, amount=5000)
    portfolio.set_price(conn, "USD", 48, day="2026-10-15")
    usd = asset(conn, "USD")
    assert len(usd["lots"]) == 2 and usd["quantity"] == pytest.approx(200)
    assert usd["cost_egp"] == pytest.approx(8000) and usd["value_egp"] == pytest.approx(9600)


def test_fund_components_are_shown_and_never_summed(conn):
    portfolio.add_holding(conn, None, buy_price=10, quantity=100,
                          custom={"kind": "fund", "name": "صندوق تجربة", "price": 12})
    portfolio.set_fund_components(conn, "custom:1", [{"asset": "COMI", "weight": 0.32}])
    summary = portfolio.portfolio_summary(conn, at=AT)
    fund = summary["groups"][0]["assets"][0]
    assert fund["components"][0]["asset"] == "COMI" and fund["components"][0]["weight"] == 0.32
    assert summary["totals"]["value"] == pytest.approx(1200) and summary["totals"]["assets"] == 1
    with pytest.raises(LedgerInputError):
        portfolio.set_fund_components(conn, "custom:1", [{"asset": "COMI", "weight": 0.7},
                                                         {"asset": "TMGH", "weight": 0.4}])
    portfolio.remove_asset(conn, "custom:1")
    assert conn.execute("SELECT COUNT(*) FROM fund_components").fetchone()[0] == 0


def test_unpriced_asset_does_not_fake_the_total(conn):
    portfolio.add_holding(conn, "EGP", buy_price=5, quantity=1000)  # the pound is always 1
    portfolio.add_holding(conn, "XAU-G", buy_price=4000, quantity=10)
    totals = portfolio.portfolio_summary(conn, at=AT)["totals"]
    assert totals["value"] == pytest.approx(1000) and totals["growth"] == pytest.approx(0)
    assert totals["unpriced"] == ["الذهب عيار 24 (جرام)"] and totals["cost"] == pytest.approx(41000)


def test_custom_asset_is_searchable_and_reused(conn):
    portfolio.add_holding(conn, None, buy_price=2, quantity=10, custom={"kind": "stock", "name": "السويدي", "symbol": "swdy"})
    portfolio.add_holding(conn, None, buy_price=3, quantity=10, custom={"kind": "stock", "name": "السويدي"})
    from egx_mcp.catalog import catalog
    mine = [e for e in catalog(conn) if e.get("custom")]
    assert len(mine) == 1 and mine[0]["symbol"] == "SWDY"
    assert len(asset(conn, "custom:1")["lots"]) == 2


def test_manual_price_loses_to_a_market_close_of_the_same_day(conn):
    from egx_mcp.market import store
    store.upsert_bars(conn, "COMI", [{"date": "2026-10-14", "open": None, "high": None, "low": None,
                                      "close": 120.0, "adjusted_close": None, "volume": None}], "EODHD")
    portfolio.add_holding(conn, "COMI", buy_price=100, quantity=1)
    portfolio.set_price(conn, "COMI", 119, day="2026-10-14")
    assert asset(conn, "COMI")["price"] == 120.0
    portfolio.set_price(conn, "COMI", 125, day="2026-10-15")
    assert asset(conn, "COMI")["price"] == 125.0 and asset(conn, "COMI")["price_source"] == "manual"


def test_the_assistants_search_follows_the_screens_rules(conn):
    from egx_mcp.catalog import normalize, search
    assert normalize("الإسترليني") == "استرليني" and normalize("أُونصة") == "اونصه"
    # 21 karat by the gram first, the ounce still among the six.
    assert [e["key"] for e in search(conn, "دهب")] == ["XAU-G21", "XAU-G", "XAU-G18", "XAU-COIN", "XAU-OZ", "XAU-G22"]
    assert search(conn, "دهب ٢١")[0]["key"] == "XAU-G21" and search(conn, "عيار 18")[0]["key"] == "XAU-G18"
    assert search(conn, "جنيه دهب")[0]["key"] == "XAU-COIN" and search(conn, "جنيه")[0]["key"] == "EGP"
    assert search(conn, "التجاري")[0]["key"] == "COMI"
    assert search(conn, "comi")[0]["key"] == "COMI" and search(conn, "") == []


def test_a_failed_purchase_leaves_no_asset_behind_and_keys_ignore_case(conn):
    with pytest.raises(LedgerInputError):
        portfolio.add_holding(conn, None, buy_price=None, quantity=1, custom={"kind": "fund", "name": "X fund", "price": 12})
    assert conn.execute("SELECT COUNT(*) FROM custom_assets").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM manual_prices").fetchone()[0] == 0
    portfolio.add_holding(conn, None, buy_price=2, quantity=3, custom={"kind": "gold", "name": "سبيكة"})
    from egx_mcp.catalog import find
    assert find(conn, "custom:1")["unit"] == "وحدة"
    assert find(conn, "usd")["key"] == "USD" and find(conn, "xau-g")["key"] == "XAU-G"


def test_egyptian_funds_are_found_by_manager_type_and_name(conn):
    import json

    from egx_mcp.catalog import FUND_TYPES, FUNDS_FILE, search
    data = json.loads(FUNDS_FILE.read_text(encoding="utf-8"))
    slugs = [f["slug"] for f in data["funds"]]
    assert len(slugs) == len(set(slugs)) and len(slugs) > 70
    assert all(f.get("manager") in (None, *data["managers"]) and f.get("type") in (None, *FUND_TYPES) for f in data["funds"])
    sabayek = search(conn, "سبائك")[0]
    assert sabayek["key"] == "fund:beltone-sabayek" and sabayek["name"] == "Beltone Sabayek" and sabayek["symbol"] == "BSB"
    assert sabayek["kind_label"] == "صندوق ذهب · بلتون" and sabayek["unit"] == "وثيقة"
    assert search(conn, "بلتون ذهب")[0]["key"] == "fund:beltone-sabayek"
    assert search(conn, "azg")[0]["key"] == "fund:az-gold" and search(conn, "az gold")[0]["key"] == "fund:az-gold"
    assert search(conn, "azimut", 20) and all(e["kind_label"].endswith("أزيموت") for e in search(conn, "ازيموت", 20))
    assert search(conn, "يوم بيوم دولار")[0]["currency"] == "USD"
    # A fund never pushes gold itself off «دهب».
    assert all(e["kind"] == "gold" for e in search(conn, "دهب"))


def test_search_finds_through_typos_spacing_and_the_wrong_keyboard(conn):
    from egx_mcp.catalog import search
    first = lambda q: search(conn, q)[0]["key"]  # noqa: E731
    assert first("سبايك") == first("سبائق") == "fund:beltone-sabayek"
    assert first("azimot") == first("ازموت") == "fund:az-gold"
    assert first("ميامية") == first("مية ميه") == "fund:beltone-meya-meya"
    assert first("b-secure") == first("بي سكيور") == "fund:b-secure"
    assert first("ؤخةه") == "COMI"  # «comi» on the Arabic keyboard
    assert first("بيتكوين") == "BTC" and first("استرلينى") == "GBP"
    assert first("تجاري دولي") == "COMI"  # the stock before the bank's funds
    assert [e["key"] for e in search(conn, "comi")] == ["COMI"]  # a close match hides the typo guesses


def test_an_asset_added_by_name_that_the_catalog_has_goes_where_it_belongs(conn):
    from egx_mcp.store.db import _relink_known_assets
    # Added as a stock with the code SPY, as an older version let it be: the migration moves it.
    conn.execute("INSERT INTO custom_assets (kind, name, symbol, currency, created_at) VALUES"
                 " ('stock', 'S&P 500 ETF', 'SPY', 'EGP', '2026-10-20T10:00:00+00:00')")
    conn.execute("INSERT INTO holdings (symbol, quantity, buy_price, created_at, updated_at, kind, name, currency, fx_egp,"
                 " cost_egp) VALUES ('custom:1', 0.1425, 32000, 'x', 'x', 'stock', 'S&P 500 ETF', 'EGP', 1, 4560)")
    conn.execute("INSERT INTO manual_prices VALUES ('custom:1', '2026-10-23', 32050, 'EGP', 'x')")
    _relink_known_assets(conn)
    row = conn.execute("SELECT symbol, kind FROM holdings").fetchone()
    assert (row["symbol"], row["kind"]) == ("SPY.US", "fund")
    assert conn.execute("SELECT COUNT(*) FROM custom_assets").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM manual_prices").fetchone()[0] == 0  # SPY.US has its own price
    # Adding it by name again lands on the fund too, with the price in the currency given.
    portfolio.add_holding(conn, None, buy_price=32000, quantity=0.1, custom={"kind": "stock", "name": "x", "symbol": "spy", "currency": "EGP"})
    lots = conn.execute("SELECT symbol, currency FROM holdings ORDER BY id").fetchall()
    assert [tuple(r) for r in lots] == [("SPY.US", "EGP"), ("SPY.US", "EGP")]


def test_the_kind_of_an_asset_added_by_name_can_change(conn):
    portfolio.add_holding(conn, None, buy_price=10, quantity=2, custom={"kind": "stock", "name": "صندوق جديد"})
    assert portfolio.set_asset_kind(conn, "custom:1", "fund")["group"] == "funds"
    assert conn.execute("SELECT kind FROM holdings").fetchone()[0] == "fund"
    with pytest.raises(LedgerInputError):
        portfolio.set_asset_kind(conn, "COMI", "fund")
    with pytest.raises(LedgerInputError):
        portfolio.set_asset_kind(conn, "custom:1", "house")


def test_a_purchase_typed_after_midnight_in_cairo_counts_from_that_day():
    from egx_mcp.store.movements import lot_day
    assert lot_day({"buy_date": None, "created_at": "2026-10-24T21:30:00+00:00"}) == "2026-10-25"
    assert lot_day({"buy_date": "2026-10-01", "created_at": "2026-10-24T21:30:00+00:00"}) == "2026-10-01"


def test_a_preview_checks_and_reads_back_without_writing(conn):
    seen = portfolio.add_holding(conn, "XAU-G", buy_price=4000, quantity=10, preview=True)["preview"]
    assert seen["quantity"] == 10 and seen["paid"] == 40000 and seen["cost_egp"] == 40000 and seen["unit_name"] == "جرام"
    assert conn.execute("SELECT COUNT(*) FROM holdings").fetchone()[0] == 0
    portfolio.add_holding(conn, None, buy_price=10, amount=100, custom={"kind": "fund", "name": "جديد", "price": 12}, preview=True)
    assert conn.execute("SELECT COUNT(*) FROM custom_assets").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM manual_prices").fetchone()[0] == 0
    with pytest.raises(LedgerInputError) as bad:
        portfolio.add_holding(conn, "XAU-G", buy_price=None, quantity=1, preview=True)
    assert bad.value.field == "price"
    # A movement: what left, what arrived, the pounds per unit, and the shortfall in words, unsaved.
    portfolio.add_holding(conn, "EGP", buy_price=1, amount=1000)
    move = portfolio.add_movement(conn, "transfer", "EGP", 1400, "SAR", 100, preview=True)["preview"]
    assert move["egp_per_unit"] == 14 and move["to"]["quantity"] == 100 and "ناقص" in move["short"]["text"]
    assert conn.execute("SELECT COUNT(*) FROM movements").fetchone()[0] == 0
