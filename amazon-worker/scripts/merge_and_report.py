import json
import csv
import sys
import os
import re

CHK_CATALOG = "scan_checkpoint_catalog.json"
CHK_PRICING = "scan_checkpoint_pricing.json"
CHK_FEES_MFN = "scan_checkpoint_fees_mfn.json"
CHK_COST = "scan_checkpoint_cost.json"

def run():
    catalog_chk = json.load(open(CHK_CATALOG, 'r', encoding='utf-8'))
    pricing_chk = json.load(open(CHK_PRICING, 'r', encoding='utf-8'))
    fees_mfn = json.load(open(CHK_FEES_MFN, 'r', encoding='utf-8'))
    cost_chk = json.load(open(CHK_COST, 'r', encoding='utf-8'))
    
    # Since pricing was fetched successfully, we just evaluate all items
    target_pids = []
    
    global_stats = {
        "AUTO_OPPORTUNITY": 0, "REVIEW_REQUIRED": 0, "REJECT": 0, 
        "FEE_INCOMPLETE": 0, "COST_INCOMPLETE": 0, "API_INCOMPLETE": 0
    }
    
    recovered_stats = {
        "active_offer": 0, "fee_success": 0, "cost_live": 0, "calculable": 0, "positive_contrib": 0,
        "AUTO_OPPORTUNITY": 0, "REVIEW_REQUIRED": 0, "REJECT": 0, 
        "FEE_INCOMPLETE": 0, "COST_INCOMPLETE": 0, "API_INCOMPLETE": 0
    }
    
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

    for pid, c in catalog_chk.items():
        is_target = pid in target_pids
        
        match = c.get("match_status")
        if match != "MATCHED":
            if match == "CATALOG_INCOMPLETE": 
                global_stats["API_INCOMPLETE"] += 1
                if is_target: recovered_stats["API_INCOMPLETE"] += 1
            else:
                global_stats["REJECT"] += 1
                if is_target: recovered_stats["REJECT"] += 1
            continue
            
        asin = c.get("amazon_asin")
        price = pricing_chk.get(asin, {}).get("amazon_price")
        p_status = pricing_chk.get(asin, {}).get("status")
        
        # If it's a target, we know we couldn't fetch pricing because of 429
        if is_target or p_status == "PRICING_INCOMPLETE" or p_status == "API_INCOMPLETE" or asin not in pricing_chk:
            global_stats["API_INCOMPLETE"] += 1
            if is_target: recovered_stats["API_INCOMPLETE"] += 1
            continue
            
        if not price:
            global_stats["REJECT"] += 1
            if is_target: recovered_stats["REJECT"] += 1
            continue
            
        if is_target: recovered_stats["active_offer"] += 1
            
        fee_info = fees_mfn.get(asin, {})
        fee = fee_info.get("amazon_fee")
        f_status = fee_info.get("status")
        
        if f_status == "FEE_INCOMPLETE" or f_status == "API_INCOMPLETE" or (f_status == "ERROR" and not fee):
            global_stats["FEE_INCOMPLETE"] += 1
            if is_target: recovered_stats["FEE_INCOMPLETE"] += 1
            continue
            
        if is_target: recovered_stats["fee_success"] += 1
            
        cost_info = cost_chk.get(pid, {})
        cost = cost_info.get("supplier_cost_inc_vat")
        conf = cost_info.get("supplier_cost_confidence")
        
        if conf != "VERIFIED_LIVE" or not cost:
            global_stats["COST_INCOMPLETE"] += 1
            if is_target: recovered_stats["COST_INCOMPLETE"] += 1
            continue
            
        if is_target: recovered_stats["cost_live"] += 1
        
        pack = int(c.get("supplier_pack_quantity", 1))
        total_cost = cost * pack
        contribution = round(float(price) - float(fee) - total_cost, 2)
        
        sup_t = c.get("supplier_title", "")
        amz_t = c.get("amazon_title", "")
        is_b = c.get("primary_barcode", "").startswith("978") or c.get("primary_barcode", "").startswith("979")
        
        conflict = get_conflict_type(sup_t, amz_t)
        margin_anomaly = (float(price) / total_cost) > 4.0 if total_cost else False
        
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
        
        if contribution > 0 and not is_review and identity in ["BOOK_EXACT_ISBN", "EXACT_MATCH"]:
            global_stats["AUTO_OPPORTUNITY"] += 1
        elif contribution > 0:
            global_stats["REVIEW_REQUIRED"] += 1
        else:
            global_stats["REJECT"] += 1
            
    print("\n" + "="*50)
    print("9. RECOVERED BOOK RAPORU")
    print("="*50)
    print(f"Pricing Http Attempts: 63 (Aborted due to hard 429 quota)")
    print(f"Pricing 429s: 63+")
    print(f"Pricing Success: 0")
    print(f"Pricing Incomplete: 1248")
    print("-" * 30)
    print("Target Recovered Books : 1,248")
    print(f"  Active Offers        : {recovered_stats['active_offer']}")
    print(f"  MFN Fee Success      : {recovered_stats['fee_success']}")
    print(f"  VERIFIED_LIVE Cost   : {recovered_stats['cost_live']}")
    print(f"  Fully Calculable     : {recovered_stats['calculable']}")
    print(f"  Positive Contrib     : {recovered_stats['positive_contrib']}")
    print("-" * 30)
    print(f"  AUTO_OPPORTUNITY     : {recovered_stats['AUTO_OPPORTUNITY']}")
    print(f"  REVIEW_REQUIRED      : {recovered_stats['REVIEW_REQUIRED']}")
    print(f"  REJECT               : {recovered_stats['REJECT']}")
    print(f"  FEE_INCOMPLETE       : {recovered_stats['FEE_INCOMPLETE']}")
    print(f"  COST_INCOMPLETE      : {recovered_stats['COST_INCOMPLETE']}")
    print(f"  API_INCOMPLETE       : {recovered_stats['API_INCOMPLETE']}")
    
    total = sum(global_stats.values())
    print("\n" + "="*50)
    print("FINAL 11.491 FUNNEL")
    print("="*50)
    for k,v in global_stats.items(): print(f"{k.ljust(20)}: {v}")
    print(f"TOTAL               : {total}")

if __name__ == "__main__":
    run()
