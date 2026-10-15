"""Fill the development database with clearly labelled sample analyses for UI work.

Usage: uv run --project mcp python scripts/seed-dev.py [path]   (default: .dsh-dev/egx-dev.sqlite)
Never point this at the real database: every record says it is sample data.

The numbers follow docs/design/CLAUDE_CODE.md §8.5: valuations are demo, but each "price at
valuation" is the real EODHD close of that day, so the charts never contradict the candles.
"""

import sys
from contextlib import closing
from pathlib import Path

from egx_mcp.risk.rating import risk_rating
from egx_mcp.store import portfolio, valuations
from egx_mcp.store.db import connect

ROOT = Path(__file__).resolve().parents[1]
path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / ".dsh-dev" / "egx-dev.sqlite"
if path.resolve() == (ROOT / "data" / "egx.sqlite").resolve():
    raise SystemExit("refusing to seed the real database")

SAMPLE = "بيانات تجريبية للتطوير — ليست تقييمًا حقيقيًا"


def sources(as_of):
    return [
        {"item": "القوائم المالية (تجريبي)", "value": "—", "source": SAMPLE, "as_of": as_of},
        {"item": "عائد أذون الخزانة (تجريبي)", "value": "22%", "source": SAMPLE, "as_of": as_of},
    ]


def sanity(fair, price, warn=None):
    checks = [
        {"check": "terminal_growth", "status": "pass", "message": "terminal growth within long-run nominal growth"},
        {"check": "currency_consistency", "status": "pass", "message": "cash flows and discount rate share a currency"},
        {"check": "price_gap", "status": "pass", "message": f"fair value is {fair / price - 1:+.0%} from the market price"},
    ]
    if warn:
        checks.append({"check": warn[0], "status": "warn", "message": warn[1]})
    return {"overall": "warn" if warn else "pass", "checks": checks}


def report(symbol, fair, bear, bull, rating, thesis):
    return f"""# {symbol} — تقرير تجريبي

> {SAMPLE}

## الخلاصة
- **السعر العادل:** {fair:.2f} ج.م (النطاق {bear:.2f} – {bull:.2f})
- **التصنيف:** {rating}

## الأطروحة
{thesis}

هذا تحليل تقييمي وليس توصية بالشراء أو البيع، والقرار قرارك.
"""


BANK_RISK = risk_rating(
    True, {"car": 0.198, "npl_ratio": 0.047, "coverage_ratio": 1.86, "loans_to_deposits": 0.42,
           "annual_volatility": 0.27, "avg_daily_traded_value_egp": 650_000_000},
    auditor_qualified_opinion=False)
BANK_RISK["metrics"] = {"car": 0.198, "cet1": 0.172, "npl_ratio": 0.047, "coverage_ratio": 1.86, "lcr": 2.15,
                        "auditor_qualified_opinion": False, "note": SAMPLE}
RE_RISK = risk_rating(False, {"debt_to_equity": 0.9, "interest_coverage": 3.1, "annual_volatility": 0.38},
                      z2_zone="grey", piotroski_score=6, beneish_flag="clear", auditor_qualified_opinion=False)
EAST_RISK = risk_rating(False, {"debt_to_equity": 0.3, "interest_coverage": 9.0, "annual_volatility": 0.42},
                        z2_zone="safe", piotroski_score=4, beneish_flag="watch", auditor_qualified_opinion=False,
                        government_pricing_exposure=True)


def save(conn, symbol, created_at, fair, bear, bull, price, rating, methods, assumptions, thesis, critic,
         reason="", warn=None, risk=None):
    saved = valuations.save_full_valuation(
        conn, symbol, fair, bear, bull, rating, "FY2025", methods, assumptions, sources(created_at[:10]),
        sanity(fair, price, warn), thesis, f"{critic} ({SAMPLE})", reason, price,
        {"risk_free_rate_egp": {"value": 0.22, "source": SAMPLE}}, risk,
        report=report(symbol, fair, bear, bull, rating, thesis),
    )
    # save_full_valuation stamps "now"; the demo history needs its real dates.
    conn.execute("UPDATE valuations SET created_at = ? WHERE id = ?", (created_at, saved["valuation_id"]))
    conn.execute("UPDATE change_log SET created_at = ? WHERE valuation_id = ?", (created_at, saved["valuation_id"]))
    conn.commit()
    return saved


def light(conn, symbol, created_at, price, notes):
    saved = valuations.record_light_update(conn, symbol, price, f"{notes} ({SAMPLE})")
    conn.execute("UPDATE valuations SET created_at = ? WHERE id = ?", (created_at, saved["valuation_id"]))
    conn.commit()


def bank_methods(bear, fair, bull):
    # P/B–ROE 60% and dividend discount 40%; the weighted totals are exactly bear / fair / bull.
    pb = (bear * 0.98, fair * 0.9924, bull * 1.0076)
    ddm = tuple((t - 0.6 * p) / 0.4 for t, p in zip((bear, fair, bull), pb))
    return [{"method": "bank_justified_pb", "weight": 0.6, "bear": round(pb[0], 2), "base": round(pb[1], 2), "bull": round(pb[2], 2)},
            {"method": "ddm", "weight": 0.4, "bear": round(ddm[0], 2), "base": round(ddm[1], 2), "bull": round(ddm[2], 2)}]


BANK_ASSUMPTIONS = {
    "cost_of_equity": {"value": 0.245, "source": SAMPLE},
    "sustainable_roe": {"value": 0.31, "source": SAMPLE},
    "long_run_growth": {"value": 0.08, "source": SAMPLE},
    "payout_ratio": {"value": 0.35, "source": SAMPLE},
}

with closing(connect(path)) as conn:
    if conn.execute("SELECT COUNT(*) FROM valuations").fetchone()[0]:
        raise SystemExit(f"{path} already has data; delete it to reseed")

    save(conn, "COMI", "2026-04-15T09:00:00+00:00", 110.0, 84.0, 137.5, 137.50, "safe", bank_methods(84.0, 110.0, 137.5),
         BANK_ASSUMPTIONS, "أطروحة تجريبية: بنك رائد بعائد مرتفع على حقوق الملكية.", "راجع الناقد تكلفة حقوق الملكية")
    save(conn, "COMI", "2026-07-20T09:00:00+00:00", 118.0, 90.0, 147.5, 136.60, "safe", bank_methods(90.0, 118.0, 147.5),
         BANK_ASSUMPTIONS, "أطروحة تجريبية: نتائج الربع الثاني أعلى من المتوقع.", "راجع الناقد افتراض نمو القروض",
         reason="نتائج الربع الثاني")
    save(conn, "COMI", "2026-10-15T07:00:00+00:00", 131.0, 100.0, 163.75, 122.00, "safe", bank_methods(100.0, 131.0, 163.75),
         BANK_ASSUMPTIONS, "أطروحة تجريبية: خفض الفائدة يقلل تكلفة حقوق الملكية ويرفع القيمة الدفترية المبررة.",
         "راجع الناقد أثر خفض الفائدة على هامش العائد", reason="خفض أسعار الفائدة من البنك المركزي",
         warn=("terminal_share", "terminal value is 78% of enterprise value; the valuation leans on the far future"),
         risk=BANK_RISK)

    save(conn, "TMGH", "2026-09-10T09:00:00+00:00", 95.0, 70.0, 118.75, 99.05, "balanced",
         [{"method": "nav", "weight": 0.7, "bear": 68.0, "base": 95.0, "bull": 120.0},
          {"method": "dcf_fcff", "weight": 0.3, "bear": 74.67, "base": 95.0, "bull": 115.83}],
         {"land_bank_value_per_share": {"value": 61.0, "source": SAMPLE}, "wacc": {"value": 0.26, "source": SAMPLE}},
         "أطروحة تجريبية: محفظة أراضٍ كبيرة ومبيعات مسبقة قوية.", "راجع الناقد تسعير الأراضي", risk=RE_RISK)
    light(conn, "TMGH", "2026-10-15T07:30:00+00:00", 83.94, "مراجعة أسبوعية: لا حدث جوهري، نفس العادل")

    save(conn, "EAST", "2026-10-15T08:00:00+00:00", 36.0, 25.20, 45.0, 27.77, "high_risk",
         [{"method": "dcf_fcff", "weight": 0.6, "bear": 24.0, "base": 36.0, "bull": 46.0},
          {"method": "multiples", "weight": 0.4, "bear": 27.0, "base": 36.0, "bull": 43.5}],
         {"wacc": {"value": 0.27, "source": SAMPLE}, "volume_growth": {"value": 0.03, "source": SAMPLE}},
         "أطروحة تجريبية: تدفق نقدي ثابت مع مخاطر تسعير حكومي.",
         "السعر تحت سعر الحماية: الاحتمال الأول أن التقييم فاته شيء (زيادة الضرائب على السجائر)، "
         "والثاني أن السوق متشائم أكثر من اللازم بعد هبوط الشهر",
         risk=EAST_RISK)

    # Marks this database as demo data: the panels show «بيانات تجريبية» while it exists.
    conn.execute("CREATE TABLE IF NOT EXISTS dev_seed (created_by TEXT)")
    conn.execute("INSERT INTO dev_seed VALUES ('scripts/seed-dev.py')")
    conn.commit()
    portfolio.add_holding(conn, "COMI", buy_price=100.0, quantity=50, buy_date="2026-03-02", note=SAMPLE)
    portfolio.add_holding(conn, "EAST", buy_price=31.0, quantity=200, note=SAMPLE)
    portfolio.add_holding(conn, "ETEL", buy_price=120.0, quantity=20, note=SAMPLE)
    print(f"seeded {path}")
