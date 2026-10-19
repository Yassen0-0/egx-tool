"""Write plugins/test/fixtures/api.json: what /egx/api answers for a small SYNTHETIC portfolio, at a
fixed Cairo time, so plugins/test/render.test.mjs can render every screen in Node.

Never reads data/egx.sqlite: everything is created in a temporary database. Re-run after an API
change:  uv run --project mcp python scripts/make-ui-fixtures.py
"""

import json
import os
import sys
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "plugins" / "test" / "fixtures" / "api.json"


def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="monos-fixtures-"))
    os.environ["EGX_DB_PATH"] = str(tmp / "egx.sqlite")
    os.environ["EGX_DATA_DIR"] = str(tmp)
    (tmp / "manual").mkdir()

    from egx_mcp.market import store
    from egx_mcp.market.calendar import CAIRO
    from egx_mcp.market.summary import market_digest, market_summary, symbol_history
    from egx_mcp.market.sync import refresh_plan
    from egx_mcp.store import portfolio, valuations, watchlist
    from egx_mcp.store.db import connect
    from egx_mcp.data import default_provider
    from egx_mcp.universe import load_universe
    import egx_mcp.market.summary as summary_mod

    at = datetime(2026, 10, 15, 8, 0, tzinfo=CAIRO)  # Thursday before the session
    conn = connect(tmp / "egx.sqlite")

    def bars(symbol, last_close, n=260, step=0.002):
        rows, day, price = [], date(2026, 10, 14), last_close
        while len(rows) < n:
            if day.weekday() in {6, 0, 1, 2, 3}:
                rows.append({"date": day.isoformat(), "open": price, "high": price * 1.01, "low": price * 0.99,
                             "close": round(price, 2), "adjusted_close": round(price, 2), "volume": 100000.0})
                price /= 1 + step
            day -= timedelta(days=1)
        store.upsert_bars(conn, symbol, list(reversed(rows)), "EODHD")

    # 12 priced stocks (one under protection), the rest waiting for a price.
    priced = {"COMI": 82.0, "TMGH": 60.0, "EAST": 31.5, "HRHO": 22.4, "FWRY": 9.1, "ADIB": 70.2, "ETEL": 41.0,
              "ABUK": 55.5, "EFIH": 18.3, "ORAS": 300.0, "JUFO": 25.7, "AMOC": 7.9}
    for sym, close in priced.items():
        bars(sym, close)
    sources = [{"item": "fixture", "value": "1", "source": "synthetic", "as_of": "2026-01-01"}]
    sanity = {"overall": "pass", "checks": [{"name": "range", "status": "pass", "message": "ok"}]}
    methods = lambda f: [{"method": "dcf_fcff", "weight": 1.0, "bear": f * 0.76, "base": f, "bull": f * 1.25}]
    for sym, fair, price in (("COMI", 95.0, 80.0), ("TMGH", 80.0, 58.0), ("EAST", 30.0, 31.0), ("COMI", 100.0, 82.0)):
        valuations.save_full_valuation(conn, sym, fair, fair * 0.76, fair * 1.25, "balanced", "FY2025", methods(fair),
                                       {"wacc": 0.24}, sources, sanity, "thesis", "critic checked the protection review", "update", price,
                                       report="# تقرير\n\nنص تجريبي.")
    for i, row in enumerate(conn.execute("SELECT id FROM valuations ORDER BY id").fetchall()):
        conn.execute("UPDATE valuations SET created_at = ? WHERE id = ?",
                     ((at - timedelta(days=30 - i * 7)).astimezone(CAIRO).isoformat(timespec="seconds"), row[0]))
    conn.commit()
    portfolio.add_holding(conn, "COMI", buy_price=70, quantity=100)
    portfolio.add_holding(conn, "TMGH", buy_price=65, invested_amount=6500)
    portfolio.add_holding(conn, "CLHO", buy_price=8, quantity=500)  # no price yet
    watchlist.add_to_watchlist(conn, "FWRY")
    watchlist.add_to_watchlist(conn, "PHDC")

    summary_mod.now_cairo = lambda: at  # symbol_history reads the clock
    api = {
        "/egx/api/market": market_summary(conn, at=at),
        "/egx/api/market/digest": market_digest(conn, at=at),
        "/egx/api/portfolio": portfolio.portfolio_summary(conn, default_provider(), at=at),
        "/egx/api/universe": load_universe(),
        "/egx/api/watchlist": {"watchlist": watchlist.list_watchlist(conn), "refresh_plan": refresh_plan(conn)},
        "/egx/api/valuations?kind=&limit=200&offset=0": valuations.list_valuations(conn, kind=None, limit=200),
    }
    for sym in ("COMI", "TMGH"):
        api[f"/egx/api/market/{sym}/history?days=365"] = symbol_history(conn, sym, 365)
    for (vid,) in conn.execute("SELECT id FROM valuations"):
        api[f"/egx/api/valuations/{vid}"] = valuations.get_valuation(conn, vid)
    for sym in ("COMI", "TMGH", "EAST"):
        api[f"/egx/api/valuations/series/{sym}"] = valuations.fair_value_series(conn, sym)
    conn.close()

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(api, ensure_ascii=False, separators=(",", ":"), default=str) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(api)} responses)")


if __name__ == "__main__":
    sys.exit(main())
