"""EGX session calendar (Africa/Cairo): Sunday..Thursday, minus the exchange holidays listed in
data/manual/holidays.csv (date,name,source; the exchange announces them, so the user keeps the
file). A holiday is not a trading day: no bar is expected, prices are not «stale» and the sync
does not spend calls on it."""

import csv
from datetime import date, datetime, time, timedelta
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from ..config import data_dir

CAIRO = ZoneInfo("Africa/Cairo")
OPEN = time(10, 0)
CLOSE = time(14, 30)
# Daily bars are normally published a while after the close.
BARS_READY = time(16, 0)
TRADING_WEEKDAYS = {6, 0, 1, 2, 3}  # Sunday..Thursday (Monday=0)


def now_cairo() -> datetime:
    return datetime.now(CAIRO)


def holidays_file() -> Path:
    return data_dir() / "manual" / "holidays.csv"


@lru_cache(maxsize=4)
def _holidays_at(path: str, mtime: float) -> frozenset[date]:
    with open(path, encoding="utf-8", newline="") as handle:
        return frozenset(date.fromisoformat(r["date"].strip()) for r in csv.DictReader(handle)
                         if (r.get("date") or "").strip())


def holidays() -> frozenset[date]:
    """Exchange holidays from the user's file (re-read when the file changes)."""
    path = holidays_file()
    try:
        return _holidays_at(str(path), path.stat().st_mtime)
    except FileNotFoundError:
        return frozenset()


def is_trading_day(day: date) -> bool:
    return day.weekday() in TRADING_WEEKDAYS and day not in holidays()


def session_open(at: datetime) -> bool:
    at = at.astimezone(CAIRO)
    return is_trading_day(at.date()) and OPEN <= at.time() < CLOSE


def previous_trading_day(day: date) -> date:
    day -= timedelta(days=1)
    while not is_trading_day(day):
        day -= timedelta(days=1)
    return day


def next_session_day(at: datetime) -> date:
    """The day the next session opens: today before 10:00 on a trading day, else the next one."""
    at = at.astimezone(CAIRO)
    day = at.date()
    if is_trading_day(day) and at.time() < OPEN:
        return day
    day += timedelta(days=1)
    while not is_trading_day(day):
        day += timedelta(days=1)
    return day


def expected_last_bar(at: datetime) -> date:
    """The most recent session whose daily bar should already be available."""
    at = at.astimezone(CAIRO)
    today = at.date()
    if is_trading_day(today) and at.time() >= BARS_READY:
        return today
    return previous_trading_day(today)
