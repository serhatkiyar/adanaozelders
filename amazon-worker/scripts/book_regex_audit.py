import json
import csv
import sys
import os
import re
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

CHK_CATALOG = "scan_checkpoint_catalog.json"
CHK_PRICING = "scan_checkpoint_pricing.json"
CHK_FEES_MFN = "scan_checkpoint_fees_mfn.json"
CHK_COST = "scan_checkpoint_cost.json"

def get_conflict_type(sup_title, amz_title):
    sup = sup_title.upper() if sup_title else ""
    amz = amz_title.upper() if amz_title else ""
    
    # Check for strict set keywords
    kw_set = r'\b(SET|TAKIM|KUTULU(?:\s*SET)?|BOX\s*SET|B[Iİıi]R\s*ARADA|X[2-9])\b'
    if re.search(kw_set, sup) or re.search(kw_set, amz):
        return "SET_KEYWORD"
        
    # Check for multi-quantity (e.g. 2 KİTAP, 3 CİLT)
    kw_qty = r'\b([2-9]|\d{2,})\s*(K[Iİıi]TAP|C[Iİıi]LT)\b'
    if re.search(kw_qty, sup) or re.search(kw_qty, amz):
        return "MULTI_QTY_KEYWORD"
        
    # Check for volume/edition (e.g. CİLT 1, VOL 2)
    kw_vol = r'\b(C[Iİıi]LT|VOL(?:UME)?)\s*(\d+)\b'
    if re.search(kw_vol, sup) or re.search(kw_vol, amz):
        return "VOLUME_KEYWORD"
        
    return None

def check_old_regex(sup_title, amz_title):
    kw = r'\b(SET|TAKIM|KUTULU|BOX\s*SET|C[Iİıi]LT|C[Iİıi]LTL[Iİıi]\s*SET|2\s*K[Iİıi]TAP|3\s*K[Iİıi]TAP|X2|X3)\b'
    sup = sup_title.upper() if sup_title else ""
    amz = amz_title.upper() if amz_title else ""
    if re.search(kw, sup) or re.search(kw, amz):
        return True
    return False

def create_funnel():
    return {
        "TOTAL": 0, "CATALOG_MATCHED": 0, "ACTIVE_OFFER": 0, "MFN_FEE_SUCCESS": 0,
        "VERIFIED_LIVE_COST": 0, "FULLY_CALCULABLE": 0, "POSITIVE_CONTRIBUTION": 0,
        "AUTO_OPPORTUNITY": 0, "REVIEW_REQUIRED": 0, "REJECT": 0,
        "API_INCOMPLETE": 0, "COST_INCOMPLETE": 0
    }

def run():
    catalog_chk = json.load(open(CHK_CATALOG, 'r', encoding='utf-8'))
    pricing_chk = json.load(open(CHK_PRICING, 'r', encoding='utf-8'))
    fees_mfn = json.load(open(CHK_FEES_MFN, 'r', encoding='utf-8'))
    cost_chk = json.load(open(CHK_COST, 'r', encoding='utf-8'))
    
    funnel_all = create_funnel()
    funnel_books = create_funnel()
    
    breakdown_101 = Counter()
    
    for pid, c in catalog_chk.items():
        row = c.copy()
        asin = row.get("amazon_asin")
        is_book = row.get("primary_barcode", "").startswith("978") or row.get("primary_barcode", "").startswith("979")
        
        funnel_all["TOTAL"] += 1
        if is_book: funnel_books["TOTAL"] += 1
        
        p_info = pricing_chk.get(asin, {}) if asin else {}
        f_info_mfn = fees_mfn.get(asin, {}) if asin else {}
        cost_info = cost_chk.get(pid, {})
        
        price = p_info.get("amazon_price")
        fee = f_info_mfn.get("amazon_fee")
        
        cost = cost_info.get("supplier_cost_inc_vat")
        confidence = cost_info.get("supplier_cost_confidence")
        if confidence != "VERIFIED_LIVE":
            cost = None
            
        pack = row.get("supplier_pack_quantity")
        
        row["calculated_supplier_cost"] = None
        row["estimated_contribution_before_shipping"] = None
        contribution = None
        
        def inc(key):
            funnel_all[key] += 1
            if is_book: funnel_books[key] += 1
            
        def finalize(status, reason):
            row["final_opportunity_status"] = status
            inc(status)
            
        # 1. CATALOG
        if row.get("match_status") == "MATCHED": inc("CATALOG_MATCHED")
        else: finalize("REJECT", "CATALOG_NOT_FOUND"); continue
            
        # 2. OFFER
        if price: inc("ACTIVE_OFFER")
        else: finalize("API_INCOMPLETE" if p_info.get("status") == "API_INCOMPLETE" else "REJECT", "NO_OFFER"); continue
            
        # 3. FEE
        if fee: inc("MFN_FEE_SUCCESS")
        else: finalize("API_INCOMPLETE" if f_info_mfn.get("status") == "API_INCOMPLETE" else "REJECT", "FEE_ERROR"); continue
            
        # 4. COST
        if cost is not None: inc("VERIFIED_LIVE_COST")
        else: finalize("COST_INCOMPLETE", "MISSING_LIVE_COST"); continue
            
        # 5. CALCULABLE
        if pack is not None:
            inc("FULLY_CALCULABLE")
            total_cost = cost * int(pack)
            row["calculated_supplier_cost"] = total_cost
            contribution = round(float(price) - float(fee) - total_cost, 2)
        else: finalize("REVIEW_REQUIRED", "PACK_MISSING"); continue
            
        # 6. CONTRIBUTION
        if contribution > 0: inc("POSITIVE_CONTRIBUTION")
        else: finalize("REJECT", "NEGATIVE_CONTRIBUTION"); continue
            
        # --- STRICT CLASSIFICATION ---
        pack_status = row.get("pack_quantity_status")
        is_primary = row.get("is_primary_barcode")
        margin_ratio = float(price) / row["calculated_supplier_cost"] if row["calculated_supplier_cost"] else 0
        
        if pack_status == "MISMATCH":
            finalize("REJECT", "PACK_MISMATCH")
            continue
            
        if not is_primary and pack_status == "UNKNOWN" and not is_book:
            finalize("REVIEW_REQUIRED", "ALT_BARCODE_UNKNOWN_PACK")
            continue
            
        if is_book:
            sup_t = row.get("supplier_title")
            amz_t = row.get("amazon_title")
            
            # For the 101 breakdown: Let's see if it WAS in the 101
            # In the previous script, it was reviewed if has_old_regex OR margin_ratio > 4.0
            old_conflict = check_old_regex(sup_t, amz_t)
            is_high_margin = margin_ratio > 4.0
            was_review = old_conflict or is_high_margin
            
            new_conflict = get_conflict_type(sup_t, amz_t)
            is_review = new_conflict is not None or is_high_margin
            
            if was_review and not is_review:
                breakdown_101["FALSE_POSITIVE_REGEX_MOVED_TO_AUTO"] += 1
            elif was_review and is_review:
                if is_high_margin and not new_conflict:
                    breakdown_101["HIGH_MARGIN_ANOMALY"] += 1
                else:
                    breakdown_101[f"TRUE_SET_CONFLICT ({new_conflict})"] += 1
                    
            if is_review:
                finalize("REVIEW_REQUIRED", "BOOK_IDENTITY_REVIEW_SET_CONFLICT")
            else:
                finalize("AUTO_OPPORTUNITY", "CLEAN_BOOK_EXACT_ISBN")
        else:
            needs_review = False
            if pack_status == "UNKNOWN": needs_review = True
            if margin_ratio > 4.0: needs_review = True
                
            if needs_review:
                finalize("REVIEW_REQUIRED", "REVIEW")
            else:
                finalize("AUTO_OPPORTUNITY", "CLEAN")

    total = funnel_all["AUTO_OPPORTUNITY"] + funnel_all["REVIEW_REQUIRED"] + funnel_all["REJECT"] + funnel_all["COST_INCOMPLETE"] + funnel_all["API_INCOMPLETE"]
    
    print("="*50)
    print("FINAL 11,491 CLASSIFICATION DISTRIBUTION")
    print("="*50)
    print(f"AUTO_OPPORTUNITY : {funnel_all['AUTO_OPPORTUNITY']}")
    print(f"REVIEW_REQUIRED  : {funnel_all['REVIEW_REQUIRED']}")
    print(f"REJECT           : {funnel_all['REJECT']}")
    print(f"COST_INCOMPLETE  : {funnel_all['COST_INCOMPLETE']}")
    print(f"API_INCOMPLETE   : {funnel_all['API_INCOMPLETE']}")
    print("-" * 30)
    print(f"TOTAL            : {total}")
    
    assert total == 11491, f"Assertion Failed! {total} != 11491"
    
    print("\n="*50)
    print("BOOK RECOVERY METRICS")
    print("="*50)
    print(f"Book AUTO_OPPORTUNITY : {funnel_books['AUTO_OPPORTUNITY']}")
    print(f"Book REVIEW_REQUIRED  : {funnel_books['REVIEW_REQUIRED']}")
    print(f"Book REJECT           : {funnel_books['REJECT']}")
    
    print("\n="*50)
    print("101 BOOK REVIEW BREAKDOWN (What happened to them?)")
    print("="*50)
    for k, v in breakdown_101.items():
        print(f"  {k}: {v}")

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    run()
