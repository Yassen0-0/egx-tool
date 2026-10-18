"""JSON command line used by the EGX panels (portfolio, analyses), sharing the MCP server logic.

    egx-cli universe
    egx-cli portfolio-summary
    egx-cli portfolio-add '{"symbol": "COMI", "buy_price": 80, "invested_amount": 5000}'
    egx-cli portfolio-update '{"holding_id": 3, "quantity": 120}'
    egx-cli portfolio-remove '{"holding_id": 3}'
    egx-cli watchlist-list
    egx-cli watchlist-add '{"symbol": "FWRY"}'
    egx-cli watchlist-remove '{"symbol": "FWRY"}'
    egx-cli valuations-list '{"symbol": "COMI", "risk_rating": "safe", "limit": 50}'
    egx-cli valuation-get '{"valuation_id": 7}'
    egx-cli valuation-series '{"symbol": "COMI"}'
    egx-cli market-summary
    egx-cli market-digest
    egx-cli market-history '{"symbol": "COMI", "days": 365}'
    egx-cli market-sync '{"force_quotes": false}'
    egx-cli validate-data

Prints one JSON document; on a rejected input prints {"error": "..."} and exits 2.
"""

import json
import sys
from contextlib import closing

from .config import data_dir, db_path
from .data import default_provider
from .data.schema import validate_data
from .errors import ValuationInputError
from .market.eodhd import EodhdClient, MarketDataError, resolve_api_key
from .market.summary import market_digest, market_summary, symbol_history
from .market.sync import refresh_plan, sync_market
from .store import portfolio, valuations, watchlist
from .store.db import connect
from .universe import load_universe


def _args(raw: str | None) -> dict:
    return json.loads(raw) if raw else {}


def run(command: str, raw: str | None) -> object:
    if command == "universe":
        return load_universe()
    if command == "market-sync":
        return _market_sync(_args(raw))
    if command == "validate-data":
        return validate_data(data_dir() / "manual")
    with closing(connect(db_path())) as conn:
        if command == "portfolio-summary":
            return portfolio.portfolio_summary(conn, default_provider())
        args = _args(raw)
        if command == "portfolio-add":
            return portfolio.add_holding(
                conn, args.get("symbol", ""), float(args.get("buy_price", 0)),
                quantity=_optional_float(args.get("quantity")),
                invested_amount=_optional_float(args.get("invested_amount")),
                buy_date=args.get("buy_date") or None, note=args.get("note") or None,
            )
        if command == "portfolio-update":
            return portfolio.update_holding(
                conn, int(args["holding_id"]),
                quantity=_optional_float(args.get("quantity")),
                buy_price=_optional_float(args.get("buy_price")),
                buy_date=args.get("buy_date"), note=args.get("note"),
            )
        if command == "portfolio-remove":
            return portfolio.remove_holding(conn, int(args["holding_id"]))
        if command == "watchlist-list":
            return _watchlist(watchlist.list_watchlist(conn), conn)
        if command == "watchlist-add":
            return _watchlist(watchlist.add_to_watchlist(conn, args["symbol"]), conn)
        if command == "watchlist-remove":
            return _watchlist(watchlist.remove_from_watchlist(conn, args["symbol"]), conn)
        if command == "valuations-list":
            return valuations.list_valuations(
                conn, args.get("symbol") or None, args.get("risk_rating") or None,
                args.get("kind", "full") or None, args.get("date_from") or None, args.get("date_to") or None,
                int(args.get("limit", 50)), int(args.get("offset", 0)),
            )
        if command == "valuation-get":
            return valuations.get_valuation(conn, int(args["valuation_id"]))
        if command == "valuation-series":
            return valuations.fair_value_series(conn, args["symbol"])
        if command == "market-summary":
            return market_summary(conn)
        if command == "market-digest":
            return market_digest(conn)
        if command == "market-history":
            return symbol_history(conn, args["symbol"], int(args.get("days", 365)))
    raise ValuationInputError(f"unknown command {command}")


def _market_sync(args: dict) -> dict:
    key = resolve_api_key()
    if not key:
        return {"ok": False, "error": "no_key",
                "message": "EODHD key not found: set EODHD_API_KEY in ~/.dsh/.env or keep the key in egx-api.docx"}
    with closing(connect(db_path())) as conn:
        return sync_market(conn, EodhdClient(key), force_quotes=bool(args.get("force_quotes")))


def _watchlist(items: list[dict], conn) -> dict:
    return {"watchlist": items, "refresh_plan": refresh_plan(conn)}


def _optional_float(value) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: egx-cli <command> [json]"}))
        sys.exit(2)
    try:
        result = run(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    except (ValuationInputError, MarketDataError, KeyError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        sys.exit(2)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
