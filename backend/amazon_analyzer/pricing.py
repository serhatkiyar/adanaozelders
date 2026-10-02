from typing import Dict, Any, List, Optional
import logging
from .client import call_sp_api
from .auth import MARKETPLACE_ID

logger = logging.getLogger(__name__)

def get_item_offers(asin: str, condition: str = "New") -> Dict[str, Any]:
    """Fallback single request."""
    path = f"/products/pricing/v0/items/{asin}/offers"
    params = {"MarketplaceId": MARKETPLACE_ID, "ItemCondition": condition}
    return call_sp_api("GET", path, params=params)

def get_item_offers_batch(asins: List[str], condition: str = "New") -> List[Dict[str, Any]]:
    """
    POST /batches/products/pricing/v0/itemOffers
    Max 20 ASINs per batch.
    """
    if not asins:
        return []

    path = "/batches/products/pricing/v0/itemOffers"
    requests = []
    
    for asin in asins:
        requests.append({
            "uri": f"/products/pricing/v0/items/{asin}/offers",
            "method": "GET",
            "MarketplaceId": MARKETPLACE_ID,
            "ItemCondition": condition
        })
        
    payload = {"requests": requests}
    
    try:
        # call_sp_api will handle 429 backoff at the top HTTP level
        response = call_sp_api("POST", path, data=payload)
        # response is {"responses": [...]}
        return response.get("responses", [])
    except Exception as e:
        logger.error(f"Batch pricing error: {str(e)}")
        # In case of total failure, we return empty list or raise
        raise

def parse_pricing_data(offers_response: Dict[str, Any]) -> Dict[str, Any]:
    """
    Parses payload from single or batch sub-response.
    """
    payload = offers_response.get("payload", {})
    summary = payload.get("Summary", {})
    
    result = {
        "offer_count": summary.get("TotalOfferCount", 0),
        "lowest_new_landed_price": None,
        "featured_offer_price": None,
        "lowest_fba_price": None,
        "lowest_mfn_price": None
    }
    
    buy_box_prices = summary.get("BuyBoxPrices", [])
    if buy_box_prices:
        for bb in buy_box_prices:
            if bb.get("condition") == "New":
                result["featured_offer_price"] = bb.get("LandedPrice", {}).get("Amount")
                break

    lowest_prices = summary.get("LowestPrices", [])
    for lp in lowest_prices:
        if lp.get("condition") == "New":
            amt = lp.get("LandedPrice", {}).get("Amount")
            channel = lp.get("fulfillmentChannel")
            if channel == "Amazon":
                result["lowest_fba_price"] = amt
            elif channel == "Merchant":
                result["lowest_mfn_price"] = amt

    if lowest_prices:
        result["lowest_new_landed_price"] = lowest_prices[0].get("LandedPrice", {}).get("Amount")

    return result
