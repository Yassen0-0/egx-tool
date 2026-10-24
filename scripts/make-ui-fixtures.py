"""Write plugins/test/fixtures/api.json: what /egx/api answers for a small SYNTHETIC ledger, at a
fixed Cairo time, so plugins/test/render.test.mjs can render «السجل» in Node.

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
    from egx_mcp.store import portfolio
    from egx_mcp.store.export import ledger_csv
    from egx_mcp.store.db import connect

    at = datetime(2026, 10, 15, 8, 0, tzinfo=CAIRO)  # Thursday before the session
    conn = connect(tmp / "egx.sqlite")

    def bars(symbol, last_close, n=260, step=0.002, every_day=False, last_day=date(2026, 10, 14)):
        rows, day, price = [], last_day, last_close
        while len(rows) < n:
            if every_day or day.weekday() in {6, 0, 1, 2, 3}:
                rows.append({"date": day.isoformat(), "open": price, "high": price * 1.01, "low": price * 0.99,
                             "close": round(price, 4), "adjusted_close": round(price, 4), "volume": 100000.0})
                price /= 1 + step
            day -= timedelta(days=1)
        store.upsert_bars(conn, symbol, list(reversed(rows)), "EODHD")

    for sym, close in {"COMI": 82.0, "TMGH": 60.0}.items():
        bars(sym, close)
    bars("USDEGP.FOREX", 48.6, n=400, step=0.0005, every_day=True)
    bars("XAUUSD.FOREX", 4100.0, n=400, step=0.001, every_day=True)
    bars("BTC-USD.CC", 67000.0, n=400, step=0.003, every_day=True)

    # One asset in every group, a stale fund price, a fund's components, an unpriced stock and two certificates.
    portfolio.add_holding(conn, "USD", buy_price=30.9, quantity=2000, buy_date="2023-03-01")
    portfolio.add_holding(conn, "USD", buy_price=49.5, amount=24750, buy_date="2025-01-05")
    portfolio.add_holding(conn, "XAU-G", buy_price=3900, quantity=20, buy_date="2025-06-01")
    portfolio.add_holding(conn, "BTC", buy_price=60000, quantity=0.05, buy_date="2026-09-10")
    portfolio.add_holding(conn, "COMI", buy_price=70, quantity=100)
    portfolio.add_holding(conn, "TMGH", buy_price=65, amount=6500)
    portfolio.add_holding(conn, "CLHO", buy_price=8, quantity=500)  # no price yet
    fund = portfolio.add_holding(conn, None, buy_price=10, quantity=3000,
                                 custom={"kind": "fund", "name": "صندوق الأهلي للأسهم", "currency": "EGP"})
    portfolio.set_price(conn, fund["symbol"], 12.4, day="2026-10-08")
    portfolio.set_fund_components(conn, fund["symbol"], [{"asset": "COMI", "weight": 0.32}, {"asset": "TMGH", "weight": 0.18}])

    # Bank certificates: one paying monthly, one paying at the end.
    # Recorded the way certificates were before they could settle into EGP (store/deposits.py).
    deposit = {"rate": 0.27, "start_date": "2025-10-15", "maturity_date": "2028-10-15", "payout": "monthly",
               "bank": "البنك الأهلي", "settle_to_egp": False}
    portfolio.add_holding(conn, amount=100000, deposit=deposit)
    portfolio.add_holding(conn, amount=50000, deposit={**deposit, "rate": 0.25, "bank": "بنك مصر",
                                                       "start_date": "2026-04-15", "payout": "maturity"})

    # «تطوّر ثروتي» is worked out from the purchases above and the stored bars (store/wealth.py),
    # with two months of inflation for the «بعد التضخم» column.
    (tmp / "manual" / "inflation.csv").write_text("month,monthly_pct,source\n2026-09,1.3,synthetic\n2026-10,0.8,synthetic\n",
                                                  encoding="utf-8")
    from egx_mcp.store import wealth

    api = {
        "/egx/api/history?days=365": wealth.wealth_history(conn, 365, at=at),
        "/egx/api/portfolio": portfolio.portfolio_summary(conn, at=at),
        "/egx/api/catalog": {"assets": portfolio.priced_catalog(conn, at)},
        "/egx/api/fx?currency=USD&date=": portfolio.fx_rate(conn, "USD", "2026-10-15"),
        "/egx/api/export": ledger_csv(conn, at),
    }
    conn.close()

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(api, ensure_ascii=False, separators=(",", ":"), default=str) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(api)} responses)")


if __name__ == "__main__":
    sys.exit(main())
