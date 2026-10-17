import json
import sys
import os

CHK_CATALOG = 'scan_checkpoint_catalog.json'
CHK_PRICING = 'scan_checkpoint_pricing.json'
CHK_FEES = 'scan_checkpoint_fees_mfn.json'
CHK_COST = 'scan_checkpoint_cost.json'

def run():
    catalog = json.load(open(CHK_CATALOG, 'r', encoding='utf-8'))
    pricing_chk = json.load(open(CHK_PRICING, 'r', encoding='utf-8')) if os.path.exists(CHK_PRICING) else {}
    fees_chk = json.load(open(CHK_FEES, 'r', encoding='utf-8')) if os.path.exists(CHK_FEES) else {}
    cost_chk = json.load(open(CHK_COST, 'r', encoding='utf-8')) if os.path.exists(CHK_COST) else {}

    f_stats = {
        'AUTO': 0,
        'REVIEW': 0,
        'REJECT': 0,
        'FEE_INCOMPLETE': 0
    }
    
    # Just to track some intermediates
    intermediates = {
        'total_matched': 0,
        'active_offer': 0,
        'verified_cost': 0,
        'positive_contrib': 0
    }

    for pid, c in catalog.items():
        if c.get("match_status") != "MATCHED":
            continue
            
        intermediates['total_matched'] += 1

        asin = c.get("amazon_asin")
        price = pricing_chk.get(asin, {}).get("amazon_price")
        fee = fees_chk.get(asin, {}).get("amazon_fee")
        
        cost_info = cost_chk.get(str(pid), {})
        cost = cost_info.get("supplier_cost_inc_vat")
        conf = cost_info.get("supplier_cost_confidence")
        
        if price is not None:
            intermediates['active_offer'] += 1
            
        if cost is not None and conf == "VERIFIED_LIVE":
            intermediates['verified_cost'] += 1

        contrib = None
        if price is not None and fee is not None and conf == "VERIFIED_LIVE" and cost is not None:
            pack = int(c.get("supplier_pack_quantity", 1))
            total_cost = cost * pack
            contrib = float(price) - float(fee) - total_cost
            if contrib > 0:
                intermediates['positive_contrib'] += 1

        # Funnel Logic exactly as requested
        if price is None:
            # No active offer -> REJECT
            f_stats['REJECT'] += 1
        elif fee is None:
            # Active offer but no fee -> FEE_INCOMPLETE
            f_stats['FEE_INCOMPLETE'] += 1
        elif conf != "VERIFIED_LIVE" or cost is None:
            # Active offer, got fee, but cost is not verified -> REJECT
            f_stats['REJECT'] += 1
        elif contrib is None or contrib <= 0:
            # Active offer, got fee, got cost, but no profit -> REJECT
            f_stats['REJECT'] += 1
        else:
            # All good, profitable
            if c.get("semantic_confidence") == "HIGH":
                f_stats['AUTO'] += 1
            else:
                f_stats['REVIEW'] += 1

    print("\n--- GLOBAL FUNNEL ---")
    print(f"TOTAL MATCHED PRODUCTS   : {intermediates['total_matched']}")
    print(f"ACTIVE OFFER (Priced)    : {intermediates['active_offer']}")
    print(f"VERIFIED LIVE COST       : {intermediates['verified_cost']}")
    print(f"POSITIVE CONTRIBUTION    : {intermediates['positive_contrib']}")
    print("\nFINAL PIPELINE BUCKETS:")
    print(f"AUTO                     : {f_stats['AUTO']}")
    print(f"REVIEW                   : {f_stats['REVIEW']}")
    print(f"REJECT                   : {f_stats['REJECT']}")
    print(f"FEE_INCOMPLETE           : {f_stats['FEE_INCOMPLETE']}")
    print(f"SUM                      : {sum(f_stats.values())}")

if __name__ == "__main__":
    run()
