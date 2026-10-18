"""The shape of the files under data/manual, checked before anything reads them.

A misspelled field (net_incom) used to be kept silently and later reported as "missing"; a wrong
date or a text in a number field crashed deep inside a tool. These models reject both with the
file and the field named, and FIELD_UNITS says what unit each financial field is in, so the
statements, the risk scores (risk/from_financials.py) and the skills read the same contract.
"""

import csv
import json
from datetime import date
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

# Amounts are in the file's "unit" (normally EGP millions); the rest say their own unit.
AMOUNT = "amount (file unit)"
FIELD_UNITS: dict[str, str] = {
    **{name: AMOUNT for name in (
        "revenue", "cogs", "gross_profit", "sga", "ebit", "ebitda", "depreciation", "interest_expense",
        "net_income", "income_continuing_ops", "total_assets", "total_assets_begin", "total_assets_end",
        "current_assets", "current_liabilities", "working_capital", "receivables", "ppe_net", "securities",
        "total_liabilities", "long_term_debt", "total_debt", "cash", "total_equity", "retained_earnings",
        "minority_interest", "cfo", "capex")},
    "eps": "EGP per share",
    "dividend_per_share": "EGP per share",
    "shares_outstanding": "shares, in the file unit's scale (millions when unit is EGP millions)",
    # bank ratios, as decimals (0.15 = 15%)
    "car": "ratio", "cet1": "ratio", "npl_ratio": "ratio", "coverage_ratio": "ratio", "lcr": "ratio",
    "loans_to_deposits": "ratio", "fx_open_position_to_capital": "ratio",
}
RATIO_FIELDS = {k for k, v in FIELD_UNITS.items() if v == "ratio"}
MACRO_KEYS = ("risk_free_rate_egp", "equity_risk_premium", "long_run_nominal_growth", "inflation_yoy",
              "usd_egp", "corporate_tax_rate")
EVENT_TYPES = ("results", "dividend", "capital_increase", "acquisition", "disposal", "rights_issue",
               "split", "management", "regulatory", "other")


class Period(BaseModel):
    model_config = ConfigDict(extra="forbid")
    period: str = Field(pattern=r"^(FY|H[12]|Q[1-4]|9M)\d{4}$")
    period_end: date
    source: str = Field(min_length=1)
    data: dict[str, float | None]

    @field_validator("data")
    @classmethod
    def known_fields(cls, data: dict) -> dict:
        unknown = sorted(set(data) - set(FIELD_UNITS))
        if unknown:
            raise ValueError(f"unknown field(s) {', '.join(unknown)}; allowed: see FIELD_UNITS in data/schema.py")
        for name in RATIO_FIELDS & set(data):
            if data[name] is not None and not 0 <= data[name] <= 5:
                raise ValueError(f"{name} is a ratio (0.15 = 15%), got {data[name]}")
        return data


class FinancialsFile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    help_: str | None = Field(default=None, alias="_help")
    currency: str = "EGP"
    unit: str = "EGP millions"
    periods: list[Period]


class MacroItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    value: float | None
    as_of: str
    source: str

    @field_validator("as_of")
    @classmethod
    def date_or_blank(cls, value: str) -> str:
        if value:
            date.fromisoformat(value)
        return value


class PriceRow(BaseModel):
    symbol: str = Field(min_length=2)
    price: float = Field(gt=0)
    date: date
    source: str = Field(min_length=1)


class EventRow(BaseModel):
    symbol: str = Field(min_length=2)
    date: date
    type: str
    description: str = ""
    source: str = Field(min_length=1)

    @field_validator("type")
    @classmethod
    def known_type(cls, value: str) -> str:
        if value not in EVENT_TYPES:
            raise ValueError(f"type must be one of {', '.join(EVENT_TYPES)}")
        return value


class HolidayRow(BaseModel):
    date: date
    name: str = Field(min_length=1)
    source: str = Field(min_length=1)


def _errors(where: str, exc: ValidationError) -> list[str]:
    out = []
    for e in exc.errors():
        loc = ".".join(str(p) for p in e["loc"])
        out.append(f"{where}: {loc}: {e['msg']}" if loc else f"{where}: {e['msg']}")
    return out


def load_financials(path: Path) -> FinancialsFile:
    """Parse one financials file or raise ValueError naming the file and every bad field."""
    try:
        return FinancialsFile.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except json.JSONDecodeError as exc:
        raise ValueError(f"{path.name}: not valid JSON ({exc.msg}, line {exc.lineno})") from exc
    except ValidationError as exc:
        raise ValueError("; ".join(_errors(path.name, exc))) from exc


def _csv(path: Path, model: type[BaseModel]) -> list[str]:
    if not path.exists():
        return []
    problems = []
    with path.open(encoding="utf-8", newline="") as handle:
        for line, row in enumerate(csv.DictReader(handle), start=2):
            if not any((v or "").strip() for v in row.values()):
                continue
            try:
                model.model_validate({k: (v or "").strip() for k, v in row.items() if k})
            except ValidationError as exc:
                problems += _errors(f"{path.name} line {line}", exc)
    return problems


def validate_data(root: Path) -> dict:
    """Check every file under data/manual. Returns {"ok", "checked", "problems"}."""
    problems: list[str] = []
    checked: list[str] = []
    for path in sorted((root / "financials").glob("*.json")):
        checked.append(f"financials/{path.name}")
        try:
            load_financials(path)
        except ValueError as exc:
            problems.append(str(exc))
    macro = root / "macro.json"
    if macro.exists():
        checked.append("macro.json")
        try:
            raw = json.loads(macro.read_text(encoding="utf-8"))
            for key, item in raw.items():
                if key.startswith("_"):
                    continue
                if key not in MACRO_KEYS:
                    problems.append(f"macro.json: unknown key {key}; allowed: {', '.join(MACRO_KEYS)}")
                    continue
                try:
                    MacroItem.model_validate(item)
                except ValidationError as exc:
                    problems += _errors(f"macro.json {key}", exc)
        except json.JSONDecodeError as exc:
            problems.append(f"macro.json: not valid JSON ({exc.msg}, line {exc.lineno})")
    for name, model in (("prices.csv", PriceRow), ("events.csv", EventRow), ("holidays.csv", HolidayRow)):
        if (root / name).exists():
            checked.append(name)
            problems += _csv(root / name, model)
    return {"ok": not problems, "checked": checked, "problems": problems}
