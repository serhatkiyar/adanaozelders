from typing import Dict, Any, Optional
import logging
from .client import call_sp_api
from .auth import MARKETPLACE_ID

logger = logging.getLogger(__name__)

def get_fee_estimate(asin: str, price_amount: float, currency_code: str = "TRY", is_fba: bool = True) -> Optional[float]:
    """
    POST /productFees/v0/items/{asin}/feesEstimate
    Estimates Amazon fees for a given ASIN at a specific price.
    """
    path = f"/products/fees/v0/items/{asin}/feesEstimate"
    
    payload = {
        "FeesEstimateRequest": {
            "MarketplaceId": MARKETPLACE_ID,
            "IsAmazonFulfilled": is_fba,
            "PriceToEstimateFees": {
                "ListingPrice": {
                    "CurrencyCode": currency_code,
                    "Amount": float(price_amount)
                }
            },
            "Identifier": f"req-{asin}"
        }
    }
    
    try:
        response = call_sp_api("POST", path, data=payload)
        
        fee_estimate_result = response.get("payload", {}).get("FeesEstimateResult", {})
        import logging
        logging.getLogger(__name__).info(f"FEE DIAGNOSTIC: {fee_estimate_result}")
        if fee_estimate_result.get("Status") == "Success":
            fees_estimate = fee_estimate_result.get("FeesEstimate", {})
            total_fees = fees_estimate.get("TotalFeesEstimate", {}).get("Amount")
            return total_fees
        return None
        
    except Exception as e:
        # Diagnostic logging for 403
        logger.error(f"FEE DIAGNOSTIC: ASIN={asin}, Payload={payload}")
        logger.error(f"FEE DIAGNOSTIC: Exception={str(e)}")
        # Raise to be caught by the pilot orchestration
        raise e
