"""Fill the development database with clearly labelled sample analyses for UI work.

Usage: uv run --project mcp python scripts/seed-dev.py [path]   (default: .dsh-dev/egx-dev.sqlite)
Never point this at the real database: every record says it is sample data.
"""

import sys
from contextlib import closing
from pathlib import Path

from egx_mcp.store import portfolio, valuations
from egx_mcp.store.db import connect

ROOT = Path(__file__).resolve().parents[1]
path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / ".dsh-dev" / "egx-dev.sqlite"
if path.resolve() == (ROOT / "data" / "egx.sqlite").resolve():
    raise SystemExit("refusing to seed the real database")

SAMPLE = "بيانات تجريبية للتطوير — ليست تقييمًا حقيقيًا"
SOURCES = [{"item": "sample", "value": "-", "source": SAMPLE, "as_of": "2026-01-01"}]
SANITY = {"overall": "warn", "checks": [
    {"check": "terminal_growth", "status": "pass", "message": "terminal growth within long-run nominal growth"},
    {"check": "price_gap", "status": "warn", "message": "fair value is +35% from the market price; explained in report"},
]}


def report(symbol, fair, bear, bull, rating):
    return f"""# {symbol} — تقرير تجريبي

> {SAMPLE}

## الخلاصة
- **السعر العادل:** {fair} ج.م (النطاق {bear} – {bull})
- **التصنيف:** {rating}

## الأطروحة
نص تجريبي لعرض شكل التقرير داخل لوحة التحليلات، مع `كود` و**نص عريض**.

| البند | القيمة | المصدر |
|---|---|---|
| WACC | 24% | {SAMPLE} |
| النمو النهائي | 8% | {SAMPLE} |

1. خطوة أولى
2. خطوة ثانية

هذا تحليل تقييمي وليس توصية بالشراء أو البيع؛ القرار قرارك.
"""


def save(conn, symbol, fair, price, rating, reason=""):
    bear, bull = round(fair * 0.8, 2), round(fair * 1.25, 2)
    return valuations.save_full_valuation(
        conn, symbol, fair, bear, bull, rating, "FY2025",
        [{"method": "dcf_fcff", "weight": 0.7, "bear": bear, "base": fair, "bull": bull},
         {"method": "multiples", "weight": 0.3, "bear": bear, "base": fair, "bull": bull}],
        {"wacc": 0.24, "terminal_growth": 0.08, "note": SAMPLE}, SOURCES, SANITY,
        f"أطروحة تجريبية لسهم {symbol}",
        f"ملاحظات ناقد تجريبية. {SAMPLE}" + (" السعر تحت سعر الحماية: الاحتمالان (التقييم فاته شيء، أو السوق متشائم) معروضان في التقرير." if price < fair * 0.8 else ""),
        reason, price,
        {"risk_free_rate_egp": {"value": 0.22}}, {"rating": rating},
        report=report(symbol, fair, bear, bull, rating),
    )


with closing(connect(path)) as conn:
    if conn.execute("SELECT COUNT(*) FROM valuations").fetchone()[0]:
        raise SystemExit(f"{path} already has data; delete it to reseed")
    save(conn, "COMI", 110.0, 104.0, "safe")
    save(conn, "COMI", 118.0, 112.0, "safe", "نتائج الربع الثالث (تجريبي)")
    save(conn, "COMI", 131.0, 122.0, "safe", "تغير الفائدة (تجريبي)")
    save(conn, "TMGH", 95.0, 84.0, "balanced")
    save(conn, "EAST", 30.0, 22.0, "high_risk")
    valuations.record_light_update(conn, "TMGH", 83.9, "مراجعة أسبوعية تجريبية")
    portfolio.add_holding(conn, "COMI", buy_price=100, invested_amount=5000, note=SAMPLE)
    print(f"seeded {path}")
