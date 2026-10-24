"""The assistant's web tools: no network here, only what they make of a page, and the addresses they refuse."""

import pytest

from egx_mcp import web
from egx_mcp.errors import LedgerInputError

RESULTS = """
<div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.ssga.com%2Fspy&amp;rut=x">SPDR <b>S&amp;P 500</b> ETF</a>
<a class="result__snippet" href="#">NAV as of Oct 23 <b>$702.10</b></a></div>
<div class="result"><a class="result__a" href="https://duckduckgo.com/y.js?ad_domain=x">Ad</a></div>
<div class="result"><a class="result__a" href="https://example.com/b">Second</a></div>
"""


def test_search_results_carry_the_real_address_and_skip_ads():
    results = web.parse_results(RESULTS, 5)
    assert results[0] == {"title": "SPDR S&P 500 ETF", "url": "https://www.ssga.com/spy", "snippet": "NAV as of Oct 23 $702.10"}
    assert [r["url"] for r in results] == ["https://www.ssga.com/spy", "https://example.com/b"]
    assert results[1]["snippet"] == "" and len(web.parse_results(RESULTS, 1)) == 1


def test_a_page_is_its_visible_text():
    title, text = web.page_text("<html><head><title>صندوق مصر</title><style>x{}</style></head><body>"
                                "<script>evil()</script><h1>سعر الوثيقة</h1><p>16.50&nbsp;ج.م</p><table><tr><td>a</td><td>b</td></tr></table></body></html>")
    assert title == "صندوق مصر"
    assert text == "سعر الوثيقة\n16.50 ج.م\na b"


@pytest.mark.parametrize("url", ["http://127.0.0.1:3180/egx/api/portfolio", "http://localhost/", "http://10.0.0.5/",
                                 "http://192.168.1.1/", "http://169.254.169.254/latest", "file:///etc/passwd", "ftp://x.com/"])
def test_the_users_own_machine_and_network_are_refused(url):
    with pytest.raises(LedgerInputError):
        web.fetch(url)


def test_an_empty_search_is_refused():
    with pytest.raises(LedgerInputError, match="تدوّر"):
        web.search("  ")
