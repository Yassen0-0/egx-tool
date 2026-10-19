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
    egx-cli market-sync-symbol '{"symbol": "CLHO"}'
    egx-cli validate-data

Prints one JSON document; on a rejected input prints {"error": "..."} and exits 2.
"""

import inspect
import json
import sys

from pydantic import ValidationError, validate_call

from .commands import CLI_COMMANDS
from .errors import ValuationInputError
from .market.eodhd import MarketDataError


def _args(raw: str | None) -> dict:
    args = json.loads(raw) if raw else {}
    if not isinstance(args, dict):
        raise ValuationInputError("arguments must be a JSON object")
    return args


def run(command: str, raw: str | None) -> object:
    """Call the commands.py function behind a CLI name, with the JSON arguments validated against its
    signature. Blank strings from the screens' forms mean "not given"; keys the function does not take
    are ignored (the screens send whole form objects)."""
    fn = CLI_COMMANDS.get(command)
    if fn is None:
        raise ValuationInputError(f"unknown command {command}")
    accepted = inspect.signature(fn).parameters
    args = {k: (None if v == "" else v) for k, v in _args(raw).items() if k in accepted}
    return validate_call(fn)(**args)


def _validation_message(exc: ValidationError) -> str:
    return "; ".join(f"{'.'.join(str(p) for p in e['loc']) or 'arguments'}: {e['msg']}" for e in exc.errors())


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: egx-cli <command> [json]"}))
        sys.exit(2)
    try:
        result = run(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    except ValidationError as exc:
        print(json.dumps({"error": _validation_message(exc)}, ensure_ascii=False))
        sys.exit(2)
    except (ValuationInputError, MarketDataError, KeyError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        sys.exit(2)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
