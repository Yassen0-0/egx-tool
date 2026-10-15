"""Minimal EODHD client for EGX tickers (<SYMBOL>.EGX).

The API key comes from EODHD_API_KEY, or from the file the user keeps it in
(EODHD_KEY_FILE, default <EGX_HOME>/egx-api.docx; plain text or .docx). The key
is never logged, returned, or written anywhere by this module.
"""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

from ..config import REPO_ROOT

BASE_URL = "https://eodhd.com/api"
SOURCE = "EODHD"
KEY_PATTERN = re.compile(r"(?<![0-9A-Za-z.])[0-9a-f]{12,20}\.[0-9]{6,10}(?![0-9A-Za-z])")


class MarketDataError(RuntimeError):
    """A provider failure with a message that is safe to show (never contains the key)."""


def _key_from_file(path: Path) -> str | None:
    if not path.exists():
        return None
    if path.suffix.lower() == ".docx":
        xml = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8", errors="replace")
        text = re.sub(r"<[^>]+>", " ", xml)
    else:
        text = path.read_text(encoding="utf-8", errors="replace")
    found = sorted(set(KEY_PATTERN.findall(text)))
    if len(found) > 1:
        raise MarketDataError(f"{path.name} contains more than one EODHD-like key; keep exactly one")
    return found[0] if found else None


def resolve_api_key() -> str | None:
    key = os.environ.get("EODHD_API_KEY", "").strip()
    if key:
        return key
    configured = os.environ.get("EODHD_KEY_FILE")
    home = Path(os.environ.get("EGX_HOME", REPO_ROOT))
    return _key_from_file(Path(configured) if configured else home / "egx-api.docx")


def ticker(symbol: str) -> str:
    return f"{symbol.upper()}.EGX"


class EodhdClient:
    def __init__(self, api_key: str, timeout: float = 30.0):
        if not api_key:
            raise MarketDataError("no EODHD API key configured")
        self._key = api_key
        self.timeout = timeout
        self.calls_made = 0

    def _get(self, path: str, cost: int = 1, **params) -> object:
        query = urllib.parse.urlencode({**params, "api_token": self._key, "fmt": "json"})
        url = f"{BASE_URL}/{path}?{query}"
        try:
            with urllib.request.urlopen(url, timeout=self.timeout) as response:
                body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace").replace(self._key, "***")[:200]
            raise MarketDataError(f"EODHD {path} returned HTTP {exc.code}: {detail}") from None
        except (urllib.error.URLError, TimeoutError) as exc:
            raise MarketDataError(f"EODHD {path} unreachable: {str(exc).replace(self._key, '***')}") from None
        finally:
            self.calls_made += cost
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            raise MarketDataError(f"EODHD {path} returned non-JSON: {body[:120]}") from None

    def account(self) -> dict:
        data = self._get("user", cost=0)
        return {
            "plan": data.get("subscriptionType"),
            "used_today": int(data.get("apiRequests") or 0),
            "daily_limit": int(data.get("dailyRateLimit") or 0),
        }

    def daily_bars(self, symbol: str, date_from: str | None = None) -> list[dict]:
        params = {"period": "d"}
        if date_from:
            params["from"] = date_from
        rows = self._get(f"eod/{ticker(symbol)}", **params)
        if not isinstance(rows, list):
            raise MarketDataError(f"unexpected EODHD daily response for {symbol}")
        return [
            {
                "date": r["date"], "open": _num(r.get("open")), "high": _num(r.get("high")),
                "low": _num(r.get("low")), "close": _num(r.get("close")),
                "adjusted_close": _num(r.get("adjusted_close")), "volume": _num(r.get("volume")),
            }
            for r in rows if _num(r.get("close")) is not None
        ]

    def quotes(self, symbols: list[str]) -> list[dict]:
        """Delayed (15-20 min) snapshots; one call per symbol."""
        if not symbols:
            return []
        first, rest = symbols[0], symbols[1:]
        params = {"s": ",".join(ticker(s) for s in rest)} if rest else {}
        data = self._get(f"real-time/{ticker(first)}", cost=len(symbols), **params)
        rows = data if isinstance(data, list) else [data]
        quotes = []
        for r in rows:
            code = str(r.get("code", "")).removesuffix(".EGX")
            quotes.append({
                "symbol": code,
                "price": _num(r.get("close")),
                "open": _num(r.get("open")), "high": _num(r.get("high")), "low": _num(r.get("low")),
                "volume": _num(r.get("volume")),
                "previous_close": _num(r.get("previousClose")),
                "change": _num(r.get("change")), "change_p": _num(r.get("change_p")),
                "quote_time": r.get("timestamp") if isinstance(r.get("timestamp"), int) else None,
            })
        return quotes


def _num(value) -> float | None:
    if value in (None, "", "NA", "N/A"):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
