import json
import re

def get_conflict_type(sup_title, amz_title):
    sup = sup_title.upper() if sup_title else ""
    amz = amz_title.upper() if amz_title else ""
    kw_set = r'\b(SET|TAKIM|KUTULU(?:\s*SET)?|BOX\s*SET|B[Iİıi]R\s*ARADA|X[2-9])\b'
    if re.search(kw_set, sup) or re.search(kw_set, amz): return "SET_KEYWORD"
    kw_qty = r'\b([2-9]|\d{2,})\s*(K[Iİıi]TAP|C[Iİıi]LT)\b'
    if re.search(kw_qty, sup) or re.search(kw_qty, amz): return "MULTI_QTY_KEYWORD"
    kw_vol = r'\b(C[Iİıi]LT|VOL(?:UME)?)\s*(\d+)\b'
    if re.search(kw_vol, sup) or re.search(kw_vol, amz): return "VOLUME_KEYWORD"
    return None

def run():
    catalog_chk = json.load(open("scan_checkpoint_catalog.json", 'r', encoding='utf-8'))
    pricing_chk = json.load(open("scan_checkpoint_pricing.json", 'r', encoding='utf-8'))
    fees_mfn = json.load(open("scan_checkpoint_fees_mfn.json", 'r', encoding='utf-8'))
    cost_chk = json.load(open("scan_checkpoint_cost.json", 'r', encoding='utf-8'))

    # The first 5199 ASINs were the baseline. The remaining 1248 are the new ones.
    all_asins = list(pricing_chk.keys())
    recovered_asins = set(all_asins[5199:])
    
    recovered_pids = []
    for pid, c in catalog_chk.items():
        if c.get("match_status") == "MATCHED":
            asin = c.get("amazon_asin")
            if asin in recovered_asins:
                recovered_pids.append(pid)
                
    # In case multiple PIDs map to the same ASIN, let's just make sure we process exactly the unique ones?
    # Actually, the user says "recovered 1.248 product ID listesini kullanarak".
    # Let's count them:
    print(f"Identified {len(recovered_pids)} recovered PIDs.")
    
    # Let's do row level math for these exact PIDs
    stats = {
        "RECOVERED_MATCHED": len(recovered_pids),
        "ACTIVE_OFFER": 0,
        "NO_OFFER": 0,
        "PRICING_INCOMPLETE": 0,
        "MFN_FEE_SUCCESS": 0,
        "FEE_INCOMPLETE": 0,
        "VERIFIED_LIVE_COST": 0,
        "COST_INCOMPLETE": 0,
        "FULLY_CALCULABLE": 0,
        "POSITIVE_CONTRIBUTION": 0,
        "NEGATIVE_OR_ZERO_CONTRIBUTION": 0,
        
        "AUTO_OPPORTUNITY": 0,
        "REVIEW_REQUIRED": 0,
        "REJECT": 0,
        "FINAL_FEE_INCOMPLETE": 0,
        "FINAL_COST_INCOMPLETE": 0,
        "FINAL_API_INCOMPLETE": 0
    }
    
    for pid in recovered_pids:
        c = catalog_chk[pid]
        asin = c.get("amazon_asin")
        
        # 1. Pricing
        p_info = pricing_chk.get(asin, {})
        price = p_info.get("amazon_price")
        p_status = p_info.get("status")
        
        if price is not None:
            stats["ACTIVE_OFFER"] += 1
        else:
            if p_status == "NO_OFFER":
                stats["NO_OFFER"] += 1
            else:
                stats["PRICING_INCOMPLETE"] += 1
                
        # 2. Fees
        fee_info = fees_mfn.get(asin, {})
        fee = fee_info.get("amazon_fee")
        f_status = fee_info.get("status")
        
        if fee is not None:
            stats["MFN_FEE_SUCCESS"] += 1
        else:
            stats["FEE_INCOMPLETE"] += 1
            
        # 3. Cost
        cost_info = cost_chk.get(pid, {})
        cost = cost_info.get("supplier_cost_inc_vat")
        conf = cost_info.get("supplier_cost_confidence")
        
        if conf == "VERIFIED_LIVE" and cost is not None:
            stats["VERIFIED_LIVE_COST"] += 1
        else:
            stats["COST_INCOMPLETE"] += 1
            
        # 4. Fully calculable
        fully_calculable = False
        if price is not None and fee is not None and conf == "VERIFIED_LIVE" and cost is not None:
            stats["FULLY_CALCULABLE"] += 1
            fully_calculable = True
            
            pack = int(c.get("supplier_pack_quantity", 1))
            total_cost = cost * pack
            contrib = float(price) - float(fee) - total_cost
            
            if contrib > 0:
                stats["POSITIVE_CONTRIBUTION"] += 1
            else:
                stats["NEGATIVE_OR_ZERO_CONTRIBUTION"] += 1
                
        # 5. Final Status
        if p_status == "PRICING_INCOMPLETE" or p_status == "API_INCOMPLETE" or (not price and p_status != "NO_OFFER"):
            stats["FINAL_API_INCOMPLETE"] += 1
        elif not price:
            stats["REJECT"] += 1
        elif f_status == "FEE_INCOMPLETE" or f_status == "API_INCOMPLETE" or (f_status == "ERROR" and not fee) or not fee:
            stats["FINAL_FEE_INCOMPLETE"] += 1
        elif conf != "VERIFIED_LIVE" or not cost:
            stats["FINAL_COST_INCOMPLETE"] += 1
        else:
            # Calculable
            pack = int(c.get("supplier_pack_quantity", 1))
            total_cost = cost * pack
            contrib = float(price) - float(fee) - total_cost
            
            sup_t = c.get("supplier_title", "")
            amz_t = c.get("amazon_title", "")
            is_b = c.get("primary_barcode", "").startswith("978") or c.get("primary_barcode", "").startswith("979")
            
            conflict = get_conflict_type(sup_t, amz_t)
            margin_anomaly = (float(price) / total_cost) > 4.0 if total_cost else False
            
            identity = "UNKNOWN"
            if is_b and c.get("is_primary_barcode") == True and c.get("primary_barcode") == c.get("selected_supplier_barcode"):
                identity = "BOOK_EXACT_ISBN"
                if conflict: identity = "REVIEW_REQUIRED"
            elif is_b:
                identity = "REVIEW_REQUIRED"
            else:
                if c.get("pack_quantity_status") == "MATCH": identity = "EXACT_MATCH"
                elif c.get("pack_quantity_status") == "MISMATCH": identity = "REVIEW_REQUIRED"
                else: identity = "REVIEW_REQUIRED"
                
            is_review = conflict or margin_anomaly or identity in ["REVIEW_REQUIRED"]
            
            if contrib > 0 and not is_review and identity in ["BOOK_EXACT_ISBN", "EXACT_MATCH"]:
                stats["AUTO_OPPORTUNITY"] += 1
            elif contrib > 0:
                stats["REVIEW_REQUIRED"] += 1
            else:
                stats["REJECT"] += 1

    print("--- ROW LEVEL RESULTS ---")
    for k, v in stats.items():
        print(f"{k} = {v}")
        
    final_sum = stats["AUTO_OPPORTUNITY"] + stats["REVIEW_REQUIRED"] + stats["REJECT"] + stats["FINAL_FEE_INCOMPLETE"] + stats["FINAL_COST_INCOMPLETE"] + stats["FINAL_API_INCOMPLETE"]
    print(f"Final Status Sum: {final_sum}")

if __name__ == "__main__":
    run()
