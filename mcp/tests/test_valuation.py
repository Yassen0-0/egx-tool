import pytest

from egx_mcp.errors import ValuationInputError
from egx_mcp.valuation.bank import justified_pb
from egx_mcp.valuation.dcf import fcff_dcf
from egx_mcp.valuation.ddm import dividend_discount
from egx_mcp.valuation.multiples import value_from_multiples
from egx_mcp.valuation.nav import net_asset_value
from egx_mcp.valuation.rates import capm_cost_of_equity, wacc
from egx_mcp.valuation.sanity import sanity_check
from egx_mcp.valuation.scenarios import combine_scenarios


def test_dcf_matches_hand_calculation():
    # PV1 = 100/1.1, PV2 = 110/1.21, TV = 110*1.02/0.08 = 1402.5 discounted two years.
    result = fcff_dcf([100, 110], wacc=0.10, terminal_growth=0.02, net_debt=0, shares_outstanding=10)
    expected_ev = 100 / 1.1 + 110 / 1.21 + 1402.5 / 1.21
    assert result["enterprise_value"] == pytest.approx(expected_ev)
    assert result["value_per_share"] == pytest.approx(expected_ev / 10)
    assert result["terminal_share_of_ev"] == pytest.approx((1402.5 / 1.21) / expected_ev)


def test_dcf_subtracts_net_debt_and_minorities():
    base = fcff_dcf([100], 0.10, 0.0, net_debt=0, shares_outstanding=1)
    levered = fcff_dcf([100], 0.10, 0.0, net_debt=200, shares_outstanding=1, minority_interest=50)
    assert levered["equity_value"] == pytest.approx(base["equity_value"] - 250)


def test_dcf_rejects_growth_above_wacc():
    with pytest.raises(ValuationInputError):
        fcff_dcf([100], wacc=0.05, terminal_growth=0.06, net_debt=0, shares_outstanding=1)


def test_gordon_growth():
    assert dividend_discount([2.0], 0.12, 0.02)["value_per_share"] == pytest.approx(20.0)


def test_two_stage_ddm():
    result = dividend_discount([1.0, 1.0], 0.10, 0.0)
    # Two dividends then a perpetuity of 1.0 from year 3: equals a plain perpetuity of 10.
    assert result["value_per_share"] == pytest.approx(10.0)


def test_justified_pb():
    result = justified_pb(10.0, sustainable_roe=0.20, cost_of_equity=0.15, long_term_growth=0.05)
    assert result["justified_pb"] == pytest.approx(1.5)
    assert result["value_per_share"] == pytest.approx(15.0)


def test_nav_with_stake_and_discount():
    result = net_asset_value(
        [{"name": "a", "value": 100, "stake": 0.5}, {"name": "b", "value": 50}],
        shares_outstanding=10, net_debt=20, discount=0.25,
    )
    assert result["nav"] == pytest.approx(80)
    assert result["value_per_share"] == pytest.approx(6.0)


def test_multiples_average():
    result = value_from_multiples(shares_outstanding=10, net_debt=100, eps=2, pe=10, ebitda=50, ev_ebitda=6)
    assert result["values_per_share"] == {"pe": pytest.approx(20), "ev_ebitda": pytest.approx(20)}
    assert result["value_per_share"] == pytest.approx(20)


def test_capm_and_wacc():
    ke = capm_cost_of_equity(0.20, 1.2, 0.05, additional_premium=0.01)["cost_of_equity"]
    assert ke == pytest.approx(0.27)
    result = wacc(ke, pre_tax_cost_of_debt=0.25, tax_rate=0.225, equity_weight=0.6)
    assert result["wacc"] == pytest.approx(0.6 * 0.27 + 0.4 * 0.25 * 0.775)


def test_combine_scenarios_weights_base_case():
    result = combine_scenarios([
        {"method": "dcf", "weight": 3, "bear": 8, "base": 10, "bull": 13},
        {"method": "multiples", "weight": 1, "bear": 10, "base": 14, "bull": 16},
    ])
    assert result["fair_value"] == pytest.approx(11.0)
    assert result["bear"] == pytest.approx(8.5)
    assert result["bull"] == pytest.approx(13.75)


def test_combine_scenarios_rejects_unordered_cases():
    with pytest.raises(ValuationInputError):
        combine_scenarios([{"method": "dcf", "weight": 1, "bear": 12, "base": 10, "bull": 13}])


def test_sanity_fails_on_currency_mix_and_excess_growth():
    result = sanity_check(
        terminal_growth=0.15, long_run_nominal_growth=0.10,
        cash_flow_currency="EGP", discount_rate_currency="USD",
    )
    assert result["overall"] == "fail"
    assert {c["check"] for c in result["checks"] if c["status"] == "fail"} == {"terminal_growth", "currency_consistency"}


def test_sanity_warns_on_large_gap_and_terminal_share():
    result = sanity_check(fair_value=30, current_price=10, terminal_share_of_ev=0.9)
    assert result["overall"] == "warn"


def test_sanity_implied_pe_outside_history():
    result = sanity_check(fair_value=40, eps=2, pe_history_range=[6, 12])
    assert result["checks"][0]["status"] == "warn"
