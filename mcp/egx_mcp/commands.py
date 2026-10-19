"""The database-backed operations, written once and served two ways:

- server.py registers the ones in MCP_TOOLS as MCP tools for the analyst (name = function name,
  description = docstring, parameters = signature);
- cli.py maps the CLI_COMMANDS names (what the screens' /egx/api routes call) to the same functions
  and validates the JSON arguments against the same signatures.

Add an operation here, then list it in MCP_TOOLS and/or CLI_COMMANDS. The pure calculators
(valuation, risk scores) need no database and stay in server.py.
"""

from contextlib import closing
from typing import Literal

from .config import data_dir, db_path
from .data import default_provider
from .data.schema import validate_data
from .errors import ValuationInputError
from .market.eodhd import EodhdClient, resolve_api_key
from .market.summary import market_digest as _market_digest
from .market.summary import market_summary, symbol_history
from .market.sync import refresh_plan, sync_market, sync_symbol
from .store import portfolio, valuations, watchlist
from .store.db import connect
from .universe import constituent, load_universe

Rating = Literal["safe", "balanced", "high_risk"]


def _db():
    return closing(connect(db_path()))


def require_symbol(symbol: str) -> dict:
    entry = constituent(symbol)
    if entry is None:
        raise ValuationInputError(f"{symbol} is not an EGX30 constituent")
    return entry


# ── universe and data ────────────────────────────────────────────────────────

def universe_list() -> dict:
    """List EGX30 constituents with weights and the suggested valuation model for each."""
    return load_universe()


def validate_manual_data() -> dict:
    """Check every file under data/manual (financials, macro, prices, events, holidays) against its
    schema and list each problem with the file and field. Run it before a valuation when inputs
    were edited by hand; the allowed financial fields and their units are in data/schema.py."""
    return validate_data(data_dir() / "manual")


# ── market cache ─────────────────────────────────────────────────────────────

def get_market_list() -> dict:
    """EGX30 market list from the local price cache: last price (delayed quote or daily close) with its
    date and source, day change, 1w/1m/3m/ytd/1y returns, 52-week range, breadth, and each stock's latest
    fair value, rating and protection status. Cite `as_of` and `source`; prices are delayed, never live."""
    with _db() as conn:
        return market_summary(conn)


def get_price_history(symbol: str, days: int = 365) -> dict:
    """Daily OHLCV bars for one EGX30 stock from the local cache (oldest first), plus the latest
    valuation levels (fair value, entry, protection, bear, bull) when one exists."""
    entry = require_symbol(symbol)
    with _db() as conn:
        return symbol_history(conn, entry["symbol"], days)


def market_digest() -> dict:
    """At most three things that changed since the previous session's close (the Market screen)."""
    with _db() as conn:
        return _market_digest(conn)


def market_sync(force_quotes: bool = False) -> dict:
    """Refresh the price cache from EODHD within today's call budget (the desktop app runs it every 5 min)."""
    key = resolve_api_key()
    if not key:
        return {"ok": False, "error": "no_key",
                "message": "EODHD key not found: set EODHD_API_KEY in ~/.dsh/.env or keep the key in egx-api.docx"}
    with _db() as conn:
        return sync_market(conn, EodhdClient(key), force_quotes=force_quotes)


def market_sync_symbol(symbol: str) -> dict:
    """Refresh one EGX30 stock's closes on request: one call, nothing when it is already current."""
    entry = constituent(symbol)
    if entry is None:
        raise ValuationInputError(f"{symbol} is not an EGX30 constituent")
    key = resolve_api_key()
    if not key:
        return {"ok": False, "error": "no_key",
                "message": "EODHD key not found: set EODHD_API_KEY in ~/.dsh/.env or keep the key in egx-api.docx"}
    with _db() as conn:
        return sync_symbol(conn, EodhdClient(key), entry["symbol"])


# ── archive ──────────────────────────────────────────────────────────────────

def list_valuations(symbol: str | None = None, risk_rating: Rating | None = None,
                    kind: Literal["full", "light"] | None = "full", date_from: str | None = None,
                    date_to: str | None = None, limit: int = 50, offset: int = 0) -> dict:
    """Search the analyses archive, newest first. Dates are YYYY-MM-DD (Cairo days). Each item carries
    the change in fair value against the symbol's previous full valuation."""
    with _db() as conn:
        return valuations.list_valuations(conn, symbol, risk_rating, kind, date_from, date_to, limit, offset)


def get_valuation(valuation_id: int) -> dict:
    """One archived valuation in full: report, assumptions, methods, sources, sanity, critic notes, change."""
    with _db() as conn:
        return valuations.get_valuation(conn, valuation_id)


def valuation_series(symbol: str) -> dict:
    """Every valuation of a symbol in time order plus the change log (the fair-value chart)."""
    with _db() as conn:
        return valuations.fair_value_series(conn, symbol)


# ── portfolio (user-entered) ─────────────────────────────────────────────────

def portfolio_add(symbol: str, buy_price: float, quantity: float | None = None,
                  invested_amount: float | None = None, buy_date: str | None = None,
                  note: str | None = None) -> dict:
    """Add a holding the user entered: give quantity, or the amount invested in EGP."""
    with _db() as conn:
        return portfolio.add_holding(conn, symbol, buy_price, quantity, invested_amount, buy_date, note)


def portfolio_update(holding_id: int, quantity: float | None = None, buy_price: float | None = None,
                     buy_date: str | None = None, note: str | None = None) -> dict:
    """Edit a holding the user entered."""
    with _db() as conn:
        return portfolio.update_holding(conn, holding_id, quantity, buy_price, buy_date, note)


def portfolio_remove(holding_id: int) -> dict:
    """Remove a holding the user entered."""
    with _db() as conn:
        return portfolio.remove_holding(conn, holding_id)


def portfolio_summary() -> dict:
    """Holdings with market value, P/L, weight, fair value, risk rating and protection price."""
    with _db() as conn:
        return portfolio.portfolio_summary(conn, default_provider())


# ── «متابعتي» ────────────────────────────────────────────────────────────────

def _watchlist(items: list[dict], conn) -> dict:
    return {"watchlist": items, "refresh_plan": refresh_plan(conn)}


def watchlist_list() -> dict:
    """The followed stocks and how the daily price budget covers them with the holdings."""
    with _db() as conn:
        return _watchlist(watchlist.list_watchlist(conn), conn)


def watchlist_add(symbol: str) -> dict:
    """Follow a stock: its price refreshes daily right after the holdings."""
    with _db() as conn:
        return _watchlist(watchlist.add_to_watchlist(conn, symbol), conn)


def watchlist_remove(symbol: str) -> dict:
    """Stop following a stock."""
    with _db() as conn:
        return _watchlist(watchlist.remove_from_watchlist(conn, symbol), conn)


# What the analyst sees as MCP tools (server.py) and what the screens call through egx-cli.
MCP_TOOLS = (
    universe_list, validate_manual_data, get_market_list, get_price_history, list_valuations,
    get_valuation, portfolio_add, portfolio_update, portfolio_remove, portfolio_summary,
)
CLI_COMMANDS = {
    "universe": universe_list,
    "validate-data": validate_manual_data,
    "market-summary": get_market_list,
    "market-history": get_price_history,
    "market-digest": market_digest,
    "market-sync": market_sync,
    "market-sync-symbol": market_sync_symbol,
    "valuations-list": list_valuations,
    "valuation-get": get_valuation,
    "valuation-series": valuation_series,
    "portfolio-summary": portfolio_summary,
    "portfolio-add": portfolio_add,
    "portfolio-update": portfolio_update,
    "portfolio-remove": portfolio_remove,
    "watchlist-list": watchlist_list,
    "watchlist-add": watchlist_add,
    "watchlist-remove": watchlist_remove,
}
