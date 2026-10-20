"""«تطوّر ثروتي»: the snapshots of a range, oldest first, and the change from the first to the last."""

from datetime import datetime

import pytest

from egx_mcp import cli
from egx_mcp.market.calendar import CAIRO
from egx_mcp.store import history
from egx_mcp.store.db import connect

AT = datetime(2026, 10, 15, 8, 0, tzinfo=CAIRO)


@pytest.fixture
def conn(tmp_path):
    connection = connect(tmp_path / "egx.sqlite")
    yield connection
    connection.close()


def snap(conn, day, value, cost):
    conn.execute("INSERT INTO ledger_snapshots (date, value_egp, cost_egp, assets, recorded_at) VALUES (?, ?, ?, 2, ?)",
                 (day, value, cost, f"{day}T18:00:00+00:00"))
    conn.commit()


def test_no_snapshots_is_an_empty_history(conn):
    assert history.wealth_history(conn, 365, at=AT) == {
        "points": [], "first": None, "last": None, "change": None, "change_pct": None}


def test_points_come_oldest_first_with_the_change_from_the_first(conn):
    snap(conn, "2026-10-14", 11000, 9000)
    snap(conn, "2026-10-01", 10000, 9000)
    snap(conn, "2026-10-10", 10500, 9500)
    result = history.wealth_history(conn, 365, at=AT)
    assert [p["date"] for p in result["points"]] == ["2026-10-01", "2026-10-10", "2026-10-14"]
    assert result["points"][1] == {"date": "2026-10-10", "value_egp": 10500, "cost_egp": 9500}
    assert result["first"]["value_egp"] == 10000 and result["last"]["value_egp"] == 11000
    assert result["change"] == 1000 and result["change_pct"] == pytest.approx(0.1)


def test_days_limits_the_range_and_the_change_is_from_its_first_point(conn):
    snap(conn, "2025-01-01", 5000, 5000)  # older than a year
    snap(conn, "2026-09-20", 8000, 7000)
    snap(conn, "2026-10-15", 6000, 7000)
    year = history.wealth_history(conn, 365, at=AT)
    assert [p["date"] for p in year["points"]] == ["2026-09-20", "2026-10-15"]
    assert year["change"] == -2000 and year["change_pct"] == pytest.approx(-0.25)
    week = history.wealth_history(conn, 7, at=AT)
    assert [p["date"] for p in week["points"]] == ["2026-10-15"] and week["change"] == 0


def test_a_bad_days_value_falls_back_and_a_zero_start_has_no_percent(conn):
    snap(conn, "2026-10-01", 0.0, 0.0)
    snap(conn, "2026-10-02", 100.0, 100.0)
    result = history.wealth_history(conn, "abc", at=AT)
    assert len(result["points"]) == 2 and result["change"] == 100 and result["change_pct"] is None


def test_history_command_is_in_the_cli_and_the_mcp_tools(tmp_path, monkeypatch):
    from egx_mcp import commands
    monkeypatch.setenv("EGX_DB_PATH", str(tmp_path / "egx.sqlite"))
    monkeypatch.setenv("EGX_DATA_DIR", str(tmp_path))
    assert commands.wealth_history in commands.MCP_TOOLS
    assert cli.run("history", '{"days": 30}')["points"] == []
