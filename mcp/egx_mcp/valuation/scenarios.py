from ..errors import ValuationInputError


def combine_scenarios(methods: list[dict]) -> dict:
    """Blend per-method bear/base/bull values into one fair-value range.

    Each method is {"method", "weight", "bear", "base", "bull"} with per-share
    values. Weights are normalised; the fair value is the weighted base case.
    """
    if not methods:
        raise ValuationInputError("methods must not be empty")
    total_weight = sum(m["weight"] for m in methods)
    if total_weight <= 0:
        raise ValuationInputError("weights must sum to a positive number")
    for m in methods:
        if m["weight"] < 0:
            raise ValuationInputError(f"weight for {m['method']} must be non-negative")
        if not m["bear"] <= m["base"] <= m["bull"]:
            raise ValuationInputError(f"{m['method']}: expected bear <= base <= bull")

    def blend(key: str) -> float:
        return sum(m[key] * m["weight"] for m in methods) / total_weight

    bear, base, bull = blend("bear"), blend("base"), blend("bull")
    return {
        "fair_value": base,
        "bear": bear,
        "base": base,
        "bull": bull,
        "range_width": (bull - bear) / base if base > 0 else None,
        "weights": {m["method"]: m["weight"] / total_weight for m in methods},
    }
