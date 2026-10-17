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
    pids = json.load(open("recovered_1248_product_ids.json", "r", encoding="utf-8"))
    
    catalog_chk = json.load(open("scan_checkpoint_catalog.json", 'r', encoding='utf-8'))
    pricing_chk = json.load(open("scan_checkpoint_pricing.json", 'r', encoding='utf-8'))
    fees_mfn = json.load(open("scan_checkpoint_fees_mfn.json", 'r', encoding='utf-8'))
    cost_chk = json.load(open("scan_checkpoint_cost.json", 'r', encoding='utf-8'))

    # Step 4: Duplicate ASIN check
    asin_to_pids = {}
    for pid in pids:
        asin = catalog_chk[pid].get("amazon_asin")
        if asin:
            if asin not in asin_to_pids:
                asin_to_pids[asin] = []
            asin_to_pids[asin].append(pid)
            
    unique_asins = len(asin_to_pids)
    duplicates = {asin: p_list for asin, p_list in asin_to_pids.items() if len(p_list) > 1}
    
    print("\n==================================================")
    print("4. DUPLICATE ASIN KONTROLÜ")
    print("==================================================")
    print(f"RECOVERED_PRODUCTS = 1248")
    print(f"UNIQUE_ASINS       = {unique_asins}")
    
    if duplicates:
        print(f"UYARI: Aynı ASIN'e map olan {len(duplicates)} adet vaka var!")
        for asin, p_list in duplicates.items():
            print(f"  ASIN {asin} -> Supplier PIDs: {p_list}")
    else:
        print("Her supplier product benzersiz bir ASIN'e map olmuş. Duplicate yok.")

    # Step 5: Exact Funnel
    stats = {
        "RECOVERED_PRODUCTS": 1248,
        "UNIQUE_ASINS": unique_asins,
        "ACTIVE_OFFER": 0,
        "NO_OFFER": 0,
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
    
    for pid in pids:
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
        if price is not None and fee is not None and conf == "VERIFIED_LIVE" and cost is not None:
            stats["FULLY_CALCULABLE"] += 1
            
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

    print("\n==================================================")
    print("5. EXACT FUNNEL (1.248 COHORT)")
    print("==================================================")
    print(f"RECOVERED_PRODUCTS = {stats['RECOVERED_PRODUCTS']}")
    print(f"UNIQUE_ASINS = {stats['UNIQUE_ASINS']}")
    print(f"ACTIVE_OFFER = {stats['ACTIVE_OFFER']}")
    print(f"NO_OFFER = {stats['NO_OFFER']}")
    print(f"MFN_FEE_SUCCESS = {stats['MFN_FEE_SUCCESS']}")
    print(f"FEE_INCOMPLETE = {stats['FEE_INCOMPLETE']}")
    print(f"VERIFIED_LIVE_COST = {stats['VERIFIED_LIVE_COST']}")
    print(f"COST_INCOMPLETE = {stats['COST_INCOMPLETE']}")
    print(f"FULLY_CALCULABLE = {stats['FULLY_CALCULABLE']}")
    print(f"POSITIVE_CONTRIBUTION = {stats['POSITIVE_CONTRIBUTION']}")
    print(f"NEGATIVE_OR_ZERO_CONTRIBUTION = {stats['NEGATIVE_OR_ZERO_CONTRIBUTION']}")
    
    print("\n--- FINAL STATUS ---")
    print(f"AUTO_OPPORTUNITY = {stats['AUTO_OPPORTUNITY']}")
    print(f"REVIEW_REQUIRED = {stats['REVIEW_REQUIRED']}")
    print(f"REJECT = {stats['REJECT']}")
    print(f"FEE_INCOMPLETE = {stats['FINAL_FEE_INCOMPLETE']}")
    print(f"COST_INCOMPLETE = {stats['FINAL_COST_INCOMPLETE']}")
    print(f"API_INCOMPLETE = {stats['FINAL_API_INCOMPLETE']}")
    
    final_sum = stats["AUTO_OPPORTUNITY"] + stats["REVIEW_REQUIRED"] + stats["REJECT"] + stats["FINAL_FEE_INCOMPLETE"] + stats["FINAL_COST_INCOMPLETE"] + stats["FINAL_API_INCOMPLETE"]
    print(f"\nFinal Status Sum: {final_sum}")

if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    run()
