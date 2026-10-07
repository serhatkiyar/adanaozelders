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

def has_book_set_conflict(sup_title, amz_title):
    kw = r'\b(SET|TAKIM|KUTULU|BOX\s*SET|C[Iİıi]LT|C[Iİıi]LTL[Iİıi]\s*SET|2\s*K[Iİıi]TAP|3\s*K[Iİıi]TAP|X2|X3)\b'
    sup = sup_title.upper() if sup_title else ""
    amz = amz_title.upper() if amz_title else ""
    if re.search(kw, sup) or re.search(kw, amz):
        return True
    return False

def get_fee_error_group(reason):
    if not reason:
        return "FEE_ERROR_UNKNOWN"
    reason_upper = reason.upper()
    if "INTERNALERROR" in reason_upper:
        return "FEE_ERROR_INTERNAL_ERROR"
    elif "INVALIDPARAMETER" in reason_upper:
        return "FEE_ERROR_INVALID_PARAMETER"
    elif "MISSINGDIMENSION" in reason_upper:
        return "FEE_ERROR_MISSING_DIMENSIONS"
    else:
        return f"FEE_ERROR_OTHER_{reason}"

def create_funnel():
    return {
        "TOTAL": 0,
        "CATALOG_MATCHED": 0,
        "ACTIVE_OFFER": 0,
        "MFN_FEE_SUCCESS": 0,
        "VERIFIED_LIVE_COST": 0,
        "FULLY_CALCULABLE": 0,
        "POSITIVE_CONTRIBUTION": 0,
        
        "AUTO_OPPORTUNITY": 0,
        "REVIEW_REQUIRED": 0,
        "REJECT": 0,
        "API_INCOMPLETE": 0,
        "COST_INCOMPLETE": 0
    }

def run():
    catalog_chk = json.load(open(CHK_CATALOG, 'r', encoding='utf-8'))
    pricing_chk = json.load(open(CHK_PRICING, 'r', encoding='utf-8'))
    fees_mfn = json.load(open(CHK_FEES_MFN, 'r', encoding='utf-8'))
    cost_chk = json.load(open(CHK_COST, 'r', encoding='utf-8'))
    
    funnel_all = create_funnel()
    funnel_books = create_funnel()
    
    final_results = []
    profitable_reject_reasons = Counter()
    book_profitable_reject_reasons = Counter()
    
    book_auto_samples = []
    
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
        
        row["amazon_price"] = price
        row["amazon_fee_mfn"] = fee
        row["supplier_cost_inc_vat"] = cost
        row["supplier_cost_confidence"] = confidence if cost else "UNVERIFIED"
        row["calculated_supplier_cost"] = None
        row["estimated_contribution_before_shipping"] = None
        
        contribution = None
        
        def inc(key):
            funnel_all[key] += 1
            if is_book: funnel_books[key] += 1
            
        def finalize(status, reason):
            row["final_opportunity_status"] = status
            row["drop_reason"] = reason
            inc(status)
            final_results.append(row)
            if contribution and contribution > 0 and status == "REJECT":
                profitable_reject_reasons[reason] += 1
                if is_book:
                    book_profitable_reject_reasons[reason] += 1
        
        # 1. CATALOG
        if row.get("match_status") == "MATCHED":
            inc("CATALOG_MATCHED")
        else:
            finalize("REJECT", row.get("match_status", "CATALOG_NOT_FOUND"))
            continue
            
        # 2. OFFER
        if price:
            inc("ACTIVE_OFFER")
        else:
            reason = p_info.get("status", "NO_OFFER")
            if reason == "API_INCOMPLETE":
                finalize("API_INCOMPLETE", reason)
            else:
                finalize("REJECT", "NO_ACTIVE_OFFER")
            continue
            
        # 3. FEE
        if fee:
            inc("MFN_FEE_SUCCESS")
        else:
            status = f_info_mfn.get("status")
            error_code = f_info_mfn.get("reason")
            if status == "API_INCOMPLETE":
                finalize("API_INCOMPLETE", "API_INCOMPLETE")
            else:
                finalize("REJECT", get_fee_error_group(error_code))
            continue
            
        # 4. COST
        if cost is not None:
            inc("VERIFIED_LIVE_COST")
        else:
            finalize("COST_INCOMPLETE", "MISSING_LIVE_COST")
            continue
            
        # 5. CALCULABLE
        if pack is not None:
            inc("FULLY_CALCULABLE")
            total_cost = cost * int(pack)
            row["calculated_supplier_cost"] = total_cost
            contribution = round(float(price) - float(fee) - total_cost, 2)
            row["estimated_contribution_before_shipping"] = contribution
        else:
            finalize("REVIEW_REQUIRED", "PACK_QUANTITY_MISSING_FOR_CALCULATION")
            continue
            
        # 6. CONTRIBUTION
        if contribution > 0:
            inc("POSITIVE_CONTRIBUTION")
        else:
            finalize("REJECT", "NEGATIVE_CONTRIBUTION")
            continue
            
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
            conflict = has_book_set_conflict(row.get("supplier_title"), row.get("amazon_title"))
            if conflict:
                row["book_identity"] = "BOOK_IDENTITY_REVIEW"
                finalize("REVIEW_REQUIRED", "BOOK_IDENTITY_REVIEW_SET_CONFLICT")
            else:
                row["book_identity"] = "BOOK_EXACT_ISBN"
                if margin_ratio > 4.0:
                    finalize("REVIEW_REQUIRED", "HIGH_MARGIN_ANOMALY")
                else:
                    finalize("AUTO_OPPORTUNITY", "CLEAN_BOOK_EXACT_ISBN")
                    if len(book_auto_samples) < 30:
                        book_auto_samples.append(row)
        else:
            needs_review = False
            review_reasons = []
            if pack_status == "UNKNOWN":
                needs_review = True
                review_reasons.append("PACK_UNKNOWN")
            if margin_ratio > 4.0:
                needs_review = True
                review_reasons.append("HIGH_MARGIN_ANOMALY")
                
            if needs_review:
                finalize("REVIEW_REQUIRED", " | ".join(review_reasons))
            else:
                finalize("AUTO_OPPORTUNITY", "CLEAN")

    def print_funnel(name, f):
        print(f"\n{'='*50}")
        print(f"FUNNEL: {name}")
        print(f"{'='*50}")
        for k in ["TOTAL", "CATALOG_MATCHED", "ACTIVE_OFFER", "MFN_FEE_SUCCESS", 
                  "VERIFIED_LIVE_COST", "FULLY_CALCULABLE", "POSITIVE_CONTRIBUTION"]:
            print(f"{k.ljust(25)}: {f[k]}")
            
        print("\n--- FINAL STATUSES ---")
        for k in ["AUTO_OPPORTUNITY", "REVIEW_REQUIRED", "REJECT", "API_INCOMPLETE", "COST_INCOMPLETE"]:
            print(f"{k.ljust(25)}: {f[k]}")
            
        total_status = f["AUTO_OPPORTUNITY"] + f["REVIEW_REQUIRED"] + f["REJECT"] + f["API_INCOMPLETE"] + f["COST_INCOMPLETE"]
        print(f"{'TOTAL CLASSIFIED'.ljust(25)}: {total_status}")
        
        assert total_status == f["TOTAL"], f"ASSERTION FAILED! {total_status} != {f['TOTAL']}"
        print("ASSERTION PASSED: Final status sum matches total products.")

    print_funnel("ALL PRODUCTS", funnel_all)
    print_funnel("BOOKS (978/979)", funnel_books)
    
    print(f"\n{'='*50}")
    print("PROFITABLE REJECT REASON BREAKDOWN")
    print(f"{'='*50}")
    print("ALL PRODUCTS (181 expected):")
    for k, v in profitable_reject_reasons.items():
        print(f"  {k}: {v}")
    print("\nBOOKS (7 expected):")
    for k, v in book_profitable_reject_reasons.items():
        print(f"  {k}: {v}")
        
    print(f"\n{'='*50}")
    print("30 EXACT ISBN AUTO OPPORTUNITIES")
    print(f"{'='*50}")
    for idx, b in enumerate(book_auto_samples, 1):
        print(f"--- SAMPLE {idx} ---")
        print(f"Supplier Title : {b.get('supplier_title')}")
        print(f"Supplier EAN   : {b.get('primary_barcode')}")
        print(f"Amazon EAN     : {b.get('selected_supplier_barcode')}")
        print(f"ASIN           : {b.get('amazon_asin')}")
        print(f"Amazon Title   : {b.get('amazon_title')}")
        print(f"Yıldırım Cost  : {b.get('supplier_cost_inc_vat')} (Conf: {b.get('supplier_cost_confidence')})")
        print(f"Amazon Price   : {b.get('amazon_price')}")
        print(f"MFN Fee        : {b.get('amazon_fee_mfn')}")
        print(f"Est. Contrib   : {b.get('estimated_contribution_before_shipping')}")
        print(f"Identity Status: {b.get('book_identity')}")
        
    with open("amazon_full_analysis_strict.csv", "w", encoding='utf-8-sig', newline='') as f:
        keys = list(final_results[0].keys())
        writer = csv.DictWriter(f, fieldnames=keys, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(final_results)

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    run()
