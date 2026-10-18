"""data/manual schema: the template and the shipped files pass, mistakes are named."""

import json
from pathlib import Path

import pytest

from egx_mcp.config import REPO_ROOT
from egx_mcp.data.manual import ManualProvider
from egx_mcp.data.schema import FIELD_UNITS, validate_data
from egx_mcp.errors import ValuationInputError
from egx_mcp.risk.from_financials import ALTMAN_FIELDS, BENEISH_CURRENT_ONLY, BENEISH_FIELDS, PIOTROSKI_FIELDS

MANUAL = REPO_ROOT / "data" / "manual"


def test_shipped_files_are_valid():
    result = validate_data(MANUAL)
    assert result["ok"], result["problems"]
    assert "financials/_TEMPLATE.json" in result["checked"]


def test_template_fields_all_have_a_unit():
    template = json.loads((MANUAL / "financials" / "_TEMPLATE.json").read_text(encoding="utf-8"))
    assert set(template["periods"][0]["data"]) <= set(FIELD_UNITS)


def test_every_field_the_scores_read_is_allowed():
    for field in ALTMAN_FIELDS + PIOTROSKI_FIELDS + BENEISH_FIELDS + BENEISH_CURRENT_ONLY:
        assert field in FIELD_UNITS, field


def _write(root: Path, symbol: str, data: dict, **period):
    (root / "financials").mkdir(parents=True, exist_ok=True)
    body = {"currency": "EGP", "unit": "EGP millions", "periods": [
        {"period": "FY2025", "period_end": "2025-12-31", "source": "annual report", "data": data, **period}]}
    (root / "financials" / f"{symbol}.json").write_text(json.dumps(body), encoding="utf-8")


def test_misspelled_field_is_named(tmp_path):
    _write(tmp_path, "COMI", {"net_incom": 5.0})
    with pytest.raises(ValuationInputError, match="COMI.json.*net_incom"):
        ManualProvider(tmp_path).get_financials("COMI")
    assert "net_incom" in validate_data(tmp_path)["problems"][0]


def test_ratio_given_as_percent_is_refused(tmp_path):
    _write(tmp_path, "COMI", {"car": 18.5})
    assert "car is a ratio" in validate_data(tmp_path)["problems"][0]


def test_bad_period_and_date(tmp_path):
    _write(tmp_path, "COMI", {}, period="2025", period_end="31/12/2025")
    problems = " ".join(validate_data(tmp_path)["problems"])
    assert "period" in problems and "period_end" in problems


def test_valid_file_reads_as_before(tmp_path):
    _write(tmp_path, "COMI", {"net_income": 5.0, "revenue": None})
    fin = ManualProvider(tmp_path).get_financials("COMI")
    assert fin.periods[0].data == {"net_income": 5.0} and fin.periods[0].period_end == "2025-12-31"


def test_csv_rows_are_checked(tmp_path):
    (tmp_path / "prices.csv").write_text("symbol,price,date,source\nCOMI,0,2026-10-14,x\n", encoding="utf-8")
    (tmp_path / "events.csv").write_text("symbol,date,type,description,source\nCOMI,2026-10-14,party,,x\n",
                                         encoding="utf-8")
    problems = " ".join(validate_data(tmp_path)["problems"])
    assert "prices.csv line 2" in problems and "events.csv line 2" in problems


def test_unknown_macro_key(tmp_path):
    (tmp_path / "macro.json").write_text(json.dumps({"risk_free": {"value": 0.2, "as_of": "", "source": ""}}),
                                         encoding="utf-8")
    assert "unknown key risk_free" in validate_data(tmp_path)["problems"][0]
