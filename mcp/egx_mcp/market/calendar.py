"""EGX session calendar (Africa/Cairo). Exchange holidays are not modelled: a missing bar on a
holiday is simply re-checked once that day and then left alone."""

import os
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

CAIRO = ZoneInfo("Africa/Cairo")
OPEN = time(10, 0)
CLOSE = time(14, 30)
# Daily bars are normally published a while after the close.
BARS_READY = time(16, 0)
TRADING_WEEKDAYS = {6, 0, 1, 2, 3}  # Sunday..Thursday (Monday=0)


def now_cairo() -> datetime:
    """Current Cairo time. EGX_NOW (an ISO timestamp, Cairo time if it has no offset) pins the clock
    for development and demos only, e.g. EGX_NOW=2026-10-15T09:02 ./scripts/run-dev.sh."""
    pinned = os.environ.get("EGX_NOW")
    if pinned:
        at = datetime.fromisoformat(pinned)
        return at.replace(tzinfo=CAIRO) if at.tzinfo is None else at.astimezone(CAIRO)
    return datetime.now(CAIRO)


def is_trading_day(day: date) -> bool:
    return day.weekday() in TRADING_WEEKDAYS


def session_open(at: datetime) -> bool:
    at = at.astimezone(CAIRO)
    return is_trading_day(at.date()) and OPEN <= at.time() < CLOSE


def previous_trading_day(day: date) -> date:
    day -= timedelta(days=1)
    while not is_trading_day(day):
        day -= timedelta(days=1)
    return day


def expected_last_bar(at: datetime) -> date:
    """The most recent session whose daily bar should already be available."""
    at = at.astimezone(CAIRO)
    today = at.date()
    if is_trading_day(today) and at.time() >= BARS_READY:
        return today
    return previous_trading_day(today)
