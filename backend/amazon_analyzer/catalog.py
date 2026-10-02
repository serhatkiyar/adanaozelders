from typing import Dict, Any, List
from .client import call_sp_api
from .auth import MARKETPLACE_ID

def search_catalog_items_batch(identifiers: List[str], identifier_type: str) -> List[Dict[str, Any]]:
    """
    Searches the Amazon Catalog Items API (2022-04-01) by a batch of EAN/ISBN/UPC.
    Max 20 identifiers per request.
    """
    if not identifiers:
        return []
        
    path = "/catalog/2022-04-01/items"
    sp_id_type = identifier_type.upper()
    
    # Strictly the minimum required data
    included_data = "identifiers,summaries,images,salesRanks,classifications"
    
    # SP-API expects a comma-separated list of identifiers
    identifiers_str = ",".join(identifiers[:20])
    
    params = {
        "marketplaceIds": MARKETPLACE_ID,
        "identifiers": identifiers_str,
        "identifiersType": sp_id_type,
        "includedData": included_data
    }
    
    try:
        response = call_sp_api("GET", path, params=params)
        return response.get("items", [])
    except Exception:
        raise
