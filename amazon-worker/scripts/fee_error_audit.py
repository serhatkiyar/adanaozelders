import json
import csv
import sys
import os
import re

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

CHK_CATALOG = "scan_checkpoint_catalog.json"
CHK_PRICING = "scan_checkpoint_pricing.json"
CHK_FEES_MFN = "scan_checkpoint_fees_mfn.json"
CHK_COST = "scan_checkpoint_cost.json"

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
    catalog_chk = json.load(open(CHK_CATALOG, 'r', encoding='utf-8'))
    pricing_chk = json.load(open(CHK_PRICING, 'r', encoding='utf-8'))
    fees_mfn = json.load(open(CHK_FEES_MFN, 'r', encoding='utf-8'))
    cost_chk = json.load(open(CHK_COST, 'r', encoding='utf-8'))
    
    funnel = {
        "AUTO_OPPORTUNITY": 0,
        "REVIEW_REQUIRED": 0,
        "REJECT": 0,
        "COST_INCOMPLETE": 0,
        "API_INCOMPLETE": 0,
        "FEE_INCOMPLETE": 0
    }
    
    # We will track what happened to the 1,280 products that previously failed due to FEE
    old_fee_errors_breakdown = {
        "REJECT_PACK_MISMATCH": 0,
        "FEE_INCOMPLETE_VERIFIED_COST": 0,
        "FEE_INCOMPLETE_NO_COST": 0,
        "OTHER": 0
    }
    
    fee_incomplete_candidates = []
    
    for pid, c in catalog_chk.items():
        row = c.copy()
        asin = row.get("amazon_asin")
        is_book = row.get("primary_barcode", "").startswith("978") or row.get("primary_barcode", "").startswith("979")
        
        p_info = pricing_chk.get(asin, {}) if asin else {}
        f_info_mfn = fees_mfn.get(asin, {}) if asin else {}
        cost_info = cost_chk.get(pid, {})
        
        price = p_info.get("amazon_price")
        fee = f_info_mfn.get("amazon_fee")
        
        cost = cost_info.get("supplier_cost_inc_vat")
        confidence = cost_info.get("supplier_cost_confidence")
        if confidence != "VERIFIED_LIVE": cost = None
            
        pack = row.get("supplier_pack_quantity")
        pack_status = row.get("pack_quantity_status")
        is_primary = row.get("is_primary_barcode")
        
        row["amazon_price"] = price
        row["amazon_fee_mfn"] = fee
        row["supplier_cost_inc_vat"] = cost
        row["supplier_cost_confidence"] = confidence if cost else "UNVERIFIED"
        
        had_fee_error = not fee and asin and price  # It reached fee step but failed
        
        def finalize(status):
            funnel[status] += 1
            if had_fee_error:
                if status == "REJECT" and pack_status == "MISMATCH":
                    old_fee_errors_breakdown["REJECT_PACK_MISMATCH"] += 1
                elif status == "FEE_INCOMPLETE":
                    if cost:
                        old_fee_errors_breakdown["FEE_INCOMPLETE_VERIFIED_COST"] += 1
                    else:
                        old_fee_errors_breakdown["FEE_INCOMPLETE_NO_COST"] += 1
                else:
                    old_fee_errors_breakdown["OTHER"] += 1
                    
        # 1. CATALOG
        if row.get("match_status") != "MATCHED":
            finalize("REJECT")
            continue
            
        # 2. OFFER
        if not price:
            finalize("API_INCOMPLETE" if p_info.get("status") == "API_INCOMPLETE" else "REJECT")
            continue
            
        # 3. IDENTITY / PACK MISMATCH
        if pack_status == "MISMATCH":
            finalize("REJECT")
            continue
            
        # 4. FEE
        if not fee:
            finalize("FEE_INCOMPLETE")
            if cost: # Has verified live cost
                fee_incomplete_candidates.append(row)
            continue
            
        # 5. COST
        if cost is None:
            finalize("COST_INCOMPLETE")
            continue
            
        # 6. CALCULABLE
        if pack is None:
            finalize("REVIEW_REQUIRED")
            continue
            
        # 7. PROFIT
        total_cost = cost * int(pack)
        row["calculated_supplier_cost"] = total_cost
        contribution = round(float(price) - float(fee) - total_cost, 2)
        row["estimated_contribution_before_shipping"] = contribution
        
        if contribution <= 0:
            finalize("REJECT")
            continue
            
        # 8. STRICT CLASSIFICATION (Positive Profit)
        margin_ratio = float(price) / row["calculated_supplier_cost"]
        
        if not is_primary and pack_status == "UNKNOWN" and not is_book:
            finalize("REVIEW_REQUIRED")
            continue
            
        if is_book:
            sup_t = row.get("supplier_title")
            amz_t = row.get("amazon_title")
            new_conflict = get_conflict_type(sup_t, amz_t)
            is_review = new_conflict is not None or margin_ratio > 4.0
            
            if is_review:
                finalize("REVIEW_REQUIRED")
            else:
                finalize("AUTO_OPPORTUNITY")
        else:
            needs_review = pack_status == "UNKNOWN" or margin_ratio > 4.0
            if needs_review:
                finalize("REVIEW_REQUIRED")
            else:
                finalize("AUTO_OPPORTUNITY")

    print("="*50)
    print("FINAL 11,491 CLASSIFICATION DISTRIBUTION")
    print("="*50)
    for k, v in funnel.items():
        print(f"{k.ljust(25)}: {v}")
        
    total = sum(funnel.values())
    print("-" * 30)
    print(f"{'TOTAL'.ljust(25)}: {total}")
    
    assert total == 11491, f"Assertion Failed! {total} != 11491"
    print("ASSERTION PASSED: Total is exactly 11,491.")
    
    print("\n="*50)
    print("1,280 FEE_ERROR_INTERNAL_ERROR BREAKDOWN")
    print("="*50)
    print("Total Fee Error Products evaluated:", sum(old_fee_errors_breakdown.values()))
    print("  -> REJECT (Pack Mismatch)        :", old_fee_errors_breakdown["REJECT_PACK_MISMATCH"])
    print("  -> FEE_INCOMPLETE (Has Live Cost):", old_fee_errors_breakdown["FEE_INCOMPLETE_VERIFIED_COST"])
    print("  -> FEE_INCOMPLETE (No Live Cost) :", old_fee_errors_breakdown["FEE_INCOMPLETE_NO_COST"])
    print("  -> OTHER                         :", old_fee_errors_breakdown["OTHER"])

    print(f"\nSaved {len(fee_incomplete_candidates)} candidates to fee_incomplete_candidates.csv")
    
    with open("fee_incomplete_candidates.csv", "w", encoding='utf-8-sig', newline='') as f:
        keys = list(fee_incomplete_candidates[0].keys())
        writer = csv.DictWriter(f, fieldnames=keys, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(fee_incomplete_candidates)

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    run()
