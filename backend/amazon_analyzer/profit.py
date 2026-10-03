from typing import Dict, Any, Optional

def calculate_profitability(
    candidate_sell_price: Optional[float],
    supplier_cost: Optional[float],
    amazon_fee_estimate: Optional[float],
    configurable_shipping_cost: float = 0.0,
    configurable_fulfillment_cost: float = 0.0
) -> Dict[str, Any]:
    """
    Calculates estimated_contribution_profit and margin.
    Flags missing cost components.
    """
    result = {
        "candidate_sell_price": candidate_sell_price,
        "supplier_cost": supplier_cost,
        "amazon_fee_estimate": amazon_fee_estimate,
        "configured_shipping_cost": configurable_shipping_cost,
        "configured_fulfillment_cost": configurable_fulfillment_cost,
        "estimated_contribution_profit": None,
        "estimated_contribution_margin_pct": None,
        "cost_completeness": "COMPLETE"
    }
    
    if candidate_sell_price is None:
        result["cost_completeness"] = "MISSING_SELL_PRICE"
        return result
        
    if supplier_cost is None:
        result["cost_completeness"] = "MISSING_SUPPLIER_COST"
        supplier_cost = 0.0
        
    if amazon_fee_estimate is None:
        result["cost_completeness"] = "MISSING_FEE_ESTIMATE"
        amazon_fee_estimate = 0.0
        
    profit = candidate_sell_price - supplier_cost - amazon_fee_estimate - configurable_shipping_cost - configurable_fulfillment_cost
    margin = (profit / candidate_sell_price * 100) if candidate_sell_price > 0 else 0.0
    
    result["estimated_contribution_profit"] = round(profit, 2)
    result["estimated_contribution_margin_pct"] = round(margin, 2)
    
    return result
