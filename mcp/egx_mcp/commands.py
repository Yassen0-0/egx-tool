"""The database-backed operations of «السجل», written once and served two ways:

- server.py registers the ones in MCP_TOOLS as MCP tools for the assistant (name = function name,
  description = docstring, parameters = signature);
- cli.py maps the CLI_COMMANDS names (what the screen's /egx/api routes call) to the same functions
  and validates the JSON arguments against the same signatures.
"""

from contextlib import closing

from .catalog import search as catalog_find
from .config import db_path
from .market.eodhd import EodhdClient, resolve_api_key
from .market.sync import sync_market
from .store import portfolio
from .store.db import connect


def _db():
    return closing(connect(db_path()))


def portfolio_summary() -> dict:
    """The ledger in EGP: total value, cost, growth, today's move, and the assets in four groups
    (currencies with gold, bitcoin, stocks, funds), each with its purchases (lots), its price and
    that price's date and source. Describe these numbers; never turn them into buy or sell advice."""
    with _db() as conn:
        return portfolio.portfolio_summary(conn)


def catalog_list() -> dict:
    """Every asset the ledger search knows, with its key, search aliases and latest known price."""
    with _db() as conn:
        return {"assets": portfolio.priced_catalog(conn)}


def catalog_search(query: str) -> dict:
    """Find an asset's key by what the user called it («دولار», «دهب», «COMI», a fund's name).
    Use the key with portfolio_add; when nothing fits, add it by name with `custom`."""
    with _db() as conn:
        return {"results": catalog_find(conn, query)}


def portfolio_add(asset: str | None = None, buy_price: float | None = None, quantity: float | None = None,
                  amount: float | None = None, currency: str | None = None, cost_egp: float | None = None,
                  buy_date: str | None = None, note: str | None = None, custom: dict | None = None) -> dict:
    """Add one purchase: `asset` is a catalog key (EGX ticker, USD, XAU-G, XAU-OZ, BTC, ...) or `custom`
    = {kind, name, symbol, currency, price} for an asset added by name. Give quantity or the amount
    paid, the unit price in `currency` (a currency's price is in EGP), the date (YYYY-MM-DD), and the
    EGP actually paid (cost_egp) when the price is not in EGP and the user knows it. Confirm with the
    user before calling."""
    with _db() as conn:
        return portfolio.add_holding(conn, asset, buy_price, quantity, amount, currency, cost_egp, buy_date,
                                     note, custom)


def portfolio_update(holding_id: int, quantity: float | None = None, buy_price: float | None = None,
                     buy_date: str | None = None, note: str | None = None, cost_egp: float | None = None) -> dict:
    """Edit one purchase; the EGP cost keeps the rate saved at purchase unless cost_egp is given.
    Confirm with the user before calling."""
    with _db() as conn:
        return portfolio.update_holding(conn, holding_id, quantity, buy_price, buy_date, note, cost_egp)


def portfolio_remove(holding_id: int) -> dict:
    """Remove one purchase. Confirm with the user before calling."""
    with _db() as conn:
        return portfolio.remove_holding(conn, holding_id)


def asset_remove(asset: str) -> dict:
    """Remove every purchase of an asset (and a fund's components). Confirm with the user before calling."""
    with _db() as conn:
        return portfolio.remove_asset(conn, asset)


def price_set(asset: str, price: float, currency: str | None = None, date: str | None = None) -> dict:
    """Record the price the user gives for an asset on a day (default today), e.g. a fund's unit
    price; a newer market price wins over it. Confirm with the user before calling."""
    with _db() as conn:
        return portfolio.set_price(conn, asset, price, currency, date)


def fx_rate(currency: str, date: str | None = None) -> dict:
    """The EGP rate a purchase in `currency` on `date` would use (null when none is known)."""
    with _db() as conn:
        return portfolio.fx_rate(conn, currency, date)


def fund_components_set(fund: str, components: list[dict]) -> dict:
    """Replace a fund's components: [{asset, weight 0–1}]. Shown under the fund, never summed.
    Confirm with the user before calling."""
    with _db() as conn:
        return portfolio.set_fund_components(conn, fund, components)


def prices_sync() -> dict:
    """Refresh the ledger's prices from EODHD within today's call budget, then record the day's total
    (the desktop app runs it every 5 minutes)."""
    key = resolve_api_key()
    if not key:
        return {"ok": False, "error": "no_key",
                "message": "EODHD key not found: set EODHD_API_KEY in ~/.dsh/.env or keep the key in egx-api.docx"}
    with _db() as conn:
        result = sync_market(conn, EodhdClient(key))
        portfolio.record_snapshot(conn)
        return result


# What the assistant sees as MCP tools (server.py) and what the screen calls through egx-cli.
MCP_TOOLS = (
    portfolio_summary, catalog_search, portfolio_add, portfolio_update, portfolio_remove, asset_remove,
    price_set, fx_rate, fund_components_set,
)
CLI_COMMANDS = {
    "portfolio-summary": portfolio_summary,
    "catalog": catalog_list,
    "catalog-search": catalog_search,
    "portfolio-add": portfolio_add,
    "portfolio-update": portfolio_update,
    "portfolio-remove": portfolio_remove,
    "asset-remove": asset_remove,
    "price-set": price_set,
    "fx-rate": fx_rate,
    "fund-components-set": fund_components_set,
    "prices-sync": prices_sync,
}
