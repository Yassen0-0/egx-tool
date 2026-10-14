from ..errors import ValuationInputError


def capm_cost_of_equity(
    risk_free_rate: float,
    beta: float,
    equity_risk_premium: float,
    additional_premium: float = 0.0,
) -> dict:
    """Ke = Rf + beta * ERP + additional premium (size, liquidity, company-specific).

    All rates are decimals in the currency of the cash flows being discounted
    (an EGP risk-free rate for EGP cash flows).
    """
    if beta < 0:
        raise ValuationInputError("beta must be non-negative")
    ke = risk_free_rate + beta * equity_risk_premium + additional_premium
    return {
        "cost_of_equity": ke,
        "components": {
            "risk_free_rate": risk_free_rate,
            "beta": beta,
            "equity_risk_premium": equity_risk_premium,
            "additional_premium": additional_premium,
        },
    }


def wacc(
    cost_of_equity: float,
    pre_tax_cost_of_debt: float,
    tax_rate: float,
    equity_weight: float,
) -> dict:
    """Weighted average cost of capital with market-value weights."""
    if not 0 <= equity_weight <= 1:
        raise ValuationInputError("equity_weight must be between 0 and 1")
    if not 0 <= tax_rate < 1:
        raise ValuationInputError("tax_rate must be between 0 and 1")
    debt_weight = 1 - equity_weight
    after_tax_kd = pre_tax_cost_of_debt * (1 - tax_rate)
    value = equity_weight * cost_of_equity + debt_weight * after_tax_kd
    return {
        "wacc": value,
        "components": {
            "cost_of_equity": cost_of_equity,
            "after_tax_cost_of_debt": after_tax_kd,
            "equity_weight": equity_weight,
            "debt_weight": debt_weight,
        },
    }
