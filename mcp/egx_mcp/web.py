"""The assistant's two web tools: search (DuckDuckGo's HTML page, no key) and fetch one page as text.

They exist so the assistant can look up what the user asks it to record: a fund's latest unit
price, a certificate's rate, a close the market feed does not carry. They never write anything; the
assistant shows what it found, with its source, and asks before saving. Pages on the user's own
machine or network (loopback, private and link-local addresses) are refused, so a page cannot steer
the assistant into the app's own API.
"""

import html
import ipaddress
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

from .errors import LedgerInputError

SEARCH_URL = "https://html.duckduckgo.com/html/"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
TIMEOUT = 15
MAX_BYTES = 2 * 1024 * 1024
MAX_CHARS = 20000
DEFAULT_CHARS = 8000


class _PublicRedirects(urllib.request.HTTPRedirectHandler):
    """Every redirect hop is checked before it is followed, not only where it ends."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _check_public(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_OPENER = urllib.request.build_opener(_PublicRedirects)


def _get(url: str, data: bytes | None = None) -> tuple[str, str]:
    """(final url, decoded body) of a public http(s) page."""
    _check_public(url)
    request = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT, "Accept-Language": "ar,en;q=0.8"})
    try:
        with _OPENER.open(request, timeout=TIMEOUT) as response:
            body = response.read(MAX_BYTES + 1)[:MAX_BYTES]
            charset = response.headers.get_content_charset() or "utf-8"
            return response.geturl(), body.decode(charset, errors="replace")
    except urllib.error.HTTPError as exc:
        raise LedgerInputError(f"الصفحة رجّعت HTTP {exc.code}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise LedgerInputError(f"مش قادر أوصل للصفحة: {getattr(exc, 'reason', exc)}") from None


def _check_public(url: str) -> None:
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise LedgerInputError("الرابط لازم يبدأ بـ http أو https")
    try:
        addresses = {info[4][0] for info in socket.getaddrinfo(parts.hostname, parts.port or 443)}
    except socket.gaierror:
        raise LedgerInputError(f"مش لاقي الموقع {parts.hostname}") from None
    for address in addresses:
        ip = ipaddress.ip_address(address.split("%")[0])
        if not ip.is_global:
            raise LedgerInputError("الرابط ده على جهازك أو شبكتك، مش على الإنترنت")


class _Text(HTMLParser):
    """Visible text and the title, without scripts, styles and the page's chrome."""

    SKIP = {"script", "style", "noscript", "svg", "template", "head"}
    BREAK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "table"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.title, self._skip, self._in_title = [], "", 0, False

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._in_title = True
        elif tag in self.SKIP:
            self._skip += 1
        elif tag in self.BREAK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag in self.SKIP and self._skip:
            self._skip -= 1
        elif tag in self.BREAK or tag == "td":
            self.parts.append("\n" if tag in self.BREAK else " ")

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self._skip:
            self.parts.append(data)


def page_text(markup: str) -> tuple[str, str]:
    """(title, text) of an HTML page: one line per block, spaces collapsed."""
    parser = _Text()
    parser.feed(markup)
    lines = (re.sub(r"[ \t ]+", " ", line).strip() for line in "".join(parser.parts).splitlines())
    return parser.title.strip(), "\n".join(line for line in lines if line)


def fetch(url: str, max_chars: int = DEFAULT_CHARS) -> dict:
    """One public page as plain text (at most max_chars), with its title and final address."""
    limit = min(max(int(max_chars or DEFAULT_CHARS), 500), MAX_CHARS)
    final, body = _get(url.strip())
    title, text = page_text(body) if "<" in body[:2000] else ("", body.strip())
    return {"url": final, "title": title, "text": text[:limit], "truncated": len(text) > limit}


_LINK = re.compile(r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.S)
_SNIPPET = re.compile(r'class="result__snippet"[^>]*>(.*?)</a>', re.S)


def _strip(fragment: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", fragment or "")).strip()


def parse_results(markup: str, limit: int) -> list[dict]:
    """DuckDuckGo's HTML results: the real address sits in the uddg parameter of its redirect link."""
    out = []
    links = list(_LINK.finditer(markup))
    for i, link in enumerate(links):
        href, title = html.unescape(link.group(1)), link.group(2)
        block = markup[link.end():links[i + 1].start() if i + 1 < len(links) else len(markup)]
        found = _SNIPPET.search(block)
        snippet = found.group(1) if found else ""
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(href).query)
        url = query.get("uddg", [href])[0]
        if url.startswith("//"):
            url = "https:" + url
        if not url.startswith("http") or "duckduckgo.com/y.js" in url:
            continue  # ads
        out.append({"title": _strip(title), "url": url, "snippet": _strip(snippet)})
        if len(out) >= limit:
            break
    return out


def search(query: str, limit: int = 5) -> dict:
    """Up to `limit` (1-10) web results for `query`: title, address and a short snippet each."""
    query = (query or "").strip()
    if not query:
        raise LedgerInputError("اكتب اللي عايز تدوّر عليه")
    _, body = _get(SEARCH_URL, urllib.parse.urlencode({"q": query, "kl": "wt-wt"}).encode())
    return {"query": query, "results": parse_results(body, min(max(int(limit or 5), 1), 10))}
