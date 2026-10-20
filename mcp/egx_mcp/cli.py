"""JSON command line behind the «السجل» screen's /egx/api routes, sharing the MCP server logic.

    egx-cli portfolio-summary
    egx-cli catalog
    egx-cli catalog-search '{"query": "دهب"}'
    egx-cli portfolio-add '{"asset": "USD", "buy_price": 48.5, "quantity": 500}'
    egx-cli portfolio-update '{"holding_id": 3, "quantity": 120}'
    egx-cli portfolio-remove '{"holding_id": 3}'
    egx-cli asset-remove '{"asset": "USD"}'
    egx-cli price-set '{"asset": "custom:1", "price": 12.4}'
    egx-cli fx-rate '{"currency": "USD", "date": "2026-10-01"}'
    egx-cli fund-components-set '{"fund": "custom:1", "components": [{"asset": "COMI", "weight": 0.32}]}'
    egx-cli prices-sync

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
