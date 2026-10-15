from egx_mcp.universe import load_universe


def test_every_constituent_has_arabic_name_and_sector():
    constituents = load_universe()["constituents"]
    assert len(constituents) == 31
    for c in constituents:
        assert c["name_ar"].strip(), c["symbol"]
        assert c["sector_ar"].strip(), c["symbol"]
        assert not any(ch.isascii() and ch.isalpha() for ch in c["name_ar"]), c["symbol"]
