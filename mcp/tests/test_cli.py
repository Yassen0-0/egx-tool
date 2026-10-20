"""egx-cli (what the screens call) and the MCP tools are one command table (commands.py)."""

import asyncio
import json
import subprocess
import sys

import pytest

from egx_mcp import cli, commands
from egx_mcp.errors import ValuationInputError


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("EGX_DB_PATH", str(tmp_path / "egx.sqlite"))
    monkeypatch.setenv("EGX_DATA_DIR", str(tmp_path))
    (tmp_path / "manual").mkdir()


def test_portfolio_round_trip_with_form_values():
    # The add form sends blanks for fields left empty and extra keys; both are fine.
    added = cli.run("portfolio-add", json.dumps({"asset": "COMI", "buy_price": "80", "quantity": "",
                                                 "amount": 4000, "note": "", "ui_only": 1}))
    assert added["quantity"] == pytest.approx(50) and added["note"] is None
    updated = cli.run("portfolio-update", json.dumps({"holding_id": added["id"], "quantity": 60}))
    assert updated["quantity"] == 60
    assert cli.run("portfolio-summary", None)["groups"][0]["assets"][0]["key"] == "COMI"
    assert any(a["key"] == "XAU-G" for a in cli.run("catalog", None)["assets"])
    assert cli.run("portfolio-remove", json.dumps({"holding_id": added["id"]}))["removed"]["id"] == added["id"]


def test_catalog_search_and_price_commands():
    assert cli.run("catalog-search", '{"query": "دهب"}')["results"][0]["kind"] == "gold"
    assert cli.run("price-set", '{"asset": "USD", "price": "48.5", "date": "2026-10-15"}')["price"] == 48.5
    assert cli.run("fx-rate", '{"currency": "usd", "date": "2026-10-16"}')["rate"] == 48.5


def test_unknown_command_and_bad_arguments():
    with pytest.raises(ValuationInputError, match="unknown command"):
        cli.run("nope", None)
    with pytest.raises(ValuationInputError, match="JSON object"):
        cli.run("portfolio-add", "[1]")


def test_main_reports_validation_errors_as_exit_2(tmp_path):
    proc = subprocess.run([sys.executable, "-m", "egx_mcp.cli", "portfolio-add", '{"asset": "COMI"}'],
                          capture_output=True, text=True)
    assert proc.returncode == 2
    assert "سعر الشرا" in json.loads(proc.stdout)["error"]


def test_market_sync_without_key_says_so(monkeypatch):
    monkeypatch.setattr(commands, "resolve_api_key", lambda: None)
    assert cli.run("prices-sync", None)["error"] == "no_key"


def test_shared_commands_are_the_mcp_tools():
    from egx_mcp import server
    names = {t.name for t in asyncio.run(server.server.list_tools())}
    assert {fn.__name__ for fn in commands.MCP_TOOLS} <= names
    assert names == {fn.__name__ for fn in commands.MCP_TOOLS}  # the ledger tools only
