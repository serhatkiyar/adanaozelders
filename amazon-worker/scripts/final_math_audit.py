import json
import csv
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

SUPPLIER_CSV = r"C:\Users\kiyar\Desktop\iş kültür scrapping\outputs\guncel_stok_2026_09_30.csv"
CHK_CATALOG = "scan_checkpoint_catalog.json"
CHK_PRICING = "scan_checkpoint_pricing.json"
CHK_FEES_MFN = "scan_checkpoint_fees_mfn.json"
CHK_COST = "scan_checkpoint_cost.json"

def run():
    catalog_chk = json.load(open(CHK_CATALOG, 'r', encoding='utf-8'))
    pricing_chk = json.load(open(CHK_PRICING, 'r', encoding='utf-8'))
    fees_mfn = json.load(open(CHK_FEES_MFN, 'r', encoding='utf-8'))
    cost_chk = json.load(open(CHK_COST, 'r', encoding='utf-8'))
    
    base_min_orders = {}
    base_costs = {}
    with open(SUPPLIER_CSV, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f, delimiter=";"):
            pid = str(row.get("id", "")).strip()
            if pid: 
                base_min_orders[pid] = int(row.get("min_siparis", 1) or 1)
                cost_str = row.get("liste_fiyat", "0").replace(",", ".")
                kdv_str = row.get("kdv", "0").replace(",", ".")
                try:
                    base_costs[pid] = float(cost_str) * (1 + float(kdv_str) / 100)
                except ValueError:
                    base_costs[pid] = 0.0

    funnel = {
        "TOTAL": 0,
        "CATALOG_MATCHED": 0,
        "ACTIVE_OFFER": 0,
        "MFN_FEE_SUCCESS": 0,
        "POSITIVE_CONTRIBUTION": 0,
        
        "AUTO_OPPORTUNITY": 0,
        "REVIEW_REQUIRED": 0,
        "REJECT": 0,
        "API_INCOMPLETE": 0
    }
    
    drop_reasons = {
        "CATALOG": {},
        "OFFER": {},
        "FEE": {},
        "CONTRIBUTION": {},
        "POSITIVE_BUT_NOT_OPPORTUNITY": {}
    }

    final_results = []
    
    for pid, c in catalog_chk.items():
        funnel["TOTAL"] += 1
        
        row = c.copy()
        asin = row.get("amazon_asin")
        
        p_info = pricing_chk.get(asin, {}) if asin else {}
        f_info_mfn = fees_mfn.get(asin, {}) if asin else {}
        cost_info = cost_chk.get(pid, {})
        
        price = p_info.get("amazon_price")
        fee = f_info_mfn.get("amazon_fee")
        cost = cost_info.get("supplier_cost_inc_vat")
        if not cost: cost = base_costs.get(pid)
        pack = row.get("supplier_pack_quantity")
        
        row["amazon_price"] = price
        row["amazon_fee_mfn"] = fee
        row["supplier_cost_inc_vat"] = cost
        row["calculated_supplier_cost"] = None
        row["estimated_contribution_before_shipping"] = None
        
        # Calculate contribution if we have numbers
        contribution = None
        if price and fee and cost and pack:
            total_cost = cost * int(pack)
            row["calculated_supplier_cost"] = total_cost
            contribution = round(float(price) - float(fee) - total_cost, 2)
            row["estimated_contribution_before_shipping"] = contribution
        
        # --- FUNNEL LOGIC ---
        
        # 1. CATALOG
        if row.get("match_status") == "MATCHED":
            funnel["CATALOG_MATCHED"] += 1
        else:
            reason = row.get("match_status", "UNKNOWN_CATALOG_REASON")
            drop_reasons["CATALOG"][reason] = drop_reasons["CATALOG"].get(reason, 0) + 1
            row["final_opportunity_status"] = "REJECT"
            row["drop_reason"] = reason
            funnel["REJECT"] += 1
            final_results.append(row)
            continue
            
        # 2. OFFER
        if price:
            funnel["ACTIVE_OFFER"] += 1
        else:
            reason = p_info.get("status", "NO_OFFER")
            if reason == "API_INCOMPLETE":
                row["final_opportunity_status"] = "API_INCOMPLETE"
                funnel["API_INCOMPLETE"] += 1
            else:
                row["final_opportunity_status"] = "REJECT"
                funnel["REJECT"] += 1
            drop_reasons["OFFER"][reason] = drop_reasons["OFFER"].get(reason, 0) + 1
            row["drop_reason"] = reason
            final_results.append(row)
            continue
            
        # 3. FEE
        if fee:
            funnel["MFN_FEE_SUCCESS"] += 1
        else:
            # Determine fee reason
            status = f_info_mfn.get("status")
            error_code = f_info_mfn.get("reason")
            if status == "API_INCOMPLETE":
                reason = "API_INCOMPLETE"
                row["final_opportunity_status"] = "API_INCOMPLETE"
                funnel["API_INCOMPLETE"] += 1
            else:
                reason = f"FEE_ERROR_{error_code}" if error_code else "FEE_ERROR_UNKNOWN"
                row["final_opportunity_status"] = "REJECT"
                funnel["REJECT"] += 1
            drop_reasons["FEE"][reason] = drop_reasons["FEE"].get(reason, 0) + 1
            row["drop_reason"] = reason
            final_results.append(row)
            continue
            
        # 4. CONTRIBUTION
        if contribution is not None and contribution > 0:
            funnel["POSITIVE_CONTRIBUTION"] += 1
        else:
            if not cost:
                reason = "COST_UNVERIFIED"
            else:
                reason = "NEGATIVE_CONTRIBUTION"
            drop_reasons["CONTRIBUTION"][reason] = drop_reasons["CONTRIBUTION"].get(reason, 0) + 1
            row["final_opportunity_status"] = "REJECT"
            row["drop_reason"] = reason
            funnel["REJECT"] += 1
            final_results.append(row)
            continue
            
        # --- CLASSIFICATION FOR POSITIVE CONTRIBUTION ---
        # We only reach here if Contribution > 0.
        
        # Check strict rules
        pack_status = row.get("pack_quantity_status")
        is_primary = row.get("is_primary_barcode")
        margin_ratio = float(price) / row["calculated_supplier_cost"] if row["calculated_supplier_cost"] else 0
        
        if pack_status == "MISMATCH":
            row["final_opportunity_status"] = "REJECT"
            reason = "PACK_MISMATCH"
            row["drop_reason"] = reason
            drop_reasons["POSITIVE_BUT_NOT_OPPORTUNITY"][reason] = drop_reasons["POSITIVE_BUT_NOT_OPPORTUNITY"].get(reason, 0) + 1
            funnel["REJECT"] += 1
            final_results.append(row)
            continue
            
        # It's not a mismatch. So it's either AUTO or REVIEW.
        needs_review = False
        review_reasons = []
        
        if pack_status == "UNKNOWN":
            needs_review = True
            review_reasons.append("PACK_UNKNOWN")
        if margin_ratio > 4.0:
            needs_review = True
            review_reasons.append("HIGH_MARGIN_ANOMALY")
        if not is_primary:
            # Alternative barcode match with UNKNOWN pack is very risky
            if pack_status == "UNKNOWN":
                needs_review = True
                review_reasons.append("ALT_BARCODE_UNKNOWN_PACK")
                
        if needs_review:
            row["final_opportunity_status"] = "REVIEW_REQUIRED"
            reason = " | ".join(review_reasons)
            row["drop_reason"] = reason
            drop_reasons["POSITIVE_BUT_NOT_OPPORTUNITY"][reason] = drop_reasons["POSITIVE_BUT_NOT_OPPORTUNITY"].get(reason, 0) + 1
            funnel["REVIEW_REQUIRED"] += 1
        else:
            row["final_opportunity_status"] = "AUTO_OPPORTUNITY"
            row["drop_reason"] = "CLEAN"
            funnel["AUTO_OPPORTUNITY"] += 1
            
        final_results.append(row)

    # Assertions
    total_classified = funnel["AUTO_OPPORTUNITY"] + funnel["REVIEW_REQUIRED"] + funnel["REJECT"] + funnel["API_INCOMPLETE"]
    assert total_classified == 11491, f"Classification mismatch! Total classified: {total_classified} != 11491"

    # PRINT REPORT
    print("="*60)
    print("FINAL MATHEMATICAL AUDIT REPORT")
    print("="*60)
    
    print("\n1. OVERALL STATUS DAĞILIMI (ASSERTION PASSED: 11,491)")
    print(f"AUTO_OPPORTUNITY : {funnel['AUTO_OPPORTUNITY']}")
    print(f"REVIEW_REQUIRED  : {funnel['REVIEW_REQUIRED']}")
    print(f"REJECT           : {funnel['REJECT']}")
    print(f"API_INCOMPLETE   : {funnel['API_INCOMPLETE']}")
    print("-" * 30)
    print(f"TOPLAM           : {total_classified}")
    
    print("\n2. FINAL FUNNEL & DROPS")
    print(f"[1] TOTAL PRODUCTS       : {funnel['TOTAL']}")
    print(f"      Drops to Match     : {funnel['TOTAL'] - funnel['CATALOG_MATCHED']}")
    for k, v in sorted(drop_reasons["CATALOG"].items(), key=lambda x: -x[1]):
        print(f"        -> {k}: {v}")
        
    print(f"[2] CATALOG_MATCHED      : {funnel['CATALOG_MATCHED']}")
    print(f"      Drops to Offer     : {funnel['CATALOG_MATCHED'] - funnel['ACTIVE_OFFER']}")
    for k, v in sorted(drop_reasons["OFFER"].items(), key=lambda x: -x[1]):
        print(f"        -> {k}: {v}")
        
    print(f"[3] ACTIVE_OFFER         : {funnel['ACTIVE_OFFER']}")
    print(f"      Drops to Fee       : {funnel['ACTIVE_OFFER'] - funnel['MFN_FEE_SUCCESS']}")
    for k, v in sorted(drop_reasons["FEE"].items(), key=lambda x: -x[1]):
        print(f"        -> {k}: {v}")
        
    print(f"[4] MFN_FEE_SUCCESS      : {funnel['MFN_FEE_SUCCESS']}")
    print(f"      Drops to Profit    : {funnel['MFN_FEE_SUCCESS'] - funnel['POSITIVE_CONTRIBUTION']}")
    for k, v in sorted(drop_reasons["CONTRIBUTION"].items(), key=lambda x: -x[1]):
        print(f"        -> {k}: {v}")
        
    print(f"[5] POSITIVE_CONTRIBUTION: {funnel['POSITIVE_CONTRIBUTION']}")
    print(f"      Drops to Auto      : {funnel['POSITIVE_CONTRIBUTION'] - funnel['AUTO_OPPORTUNITY']}")
    for k, v in sorted(drop_reasons["POSITIVE_BUT_NOT_OPPORTUNITY"].items(), key=lambda x: -x[1]):
        status = "REJECT" if "MISMATCH" in k else "REVIEW"
        print(f"        -> [{status}] {k}: {v}")
        
    print(f"[6] AUTO_OPPORTUNITY     : {funnel['AUTO_OPPORTUNITY']}")
    
    # Check specific user questions:
    print("\n3. BOOKS API/FEE GAP EXPLANATION")
    # Actually, the funnel drop reasons for FEE already answers the gap!
    # Because FEE drop reasons break down exactly what error codes Amazon returned for the missing fees.
    
    # Save the strictly corrected results
    with open("amazon_full_analysis_strict.csv", "w", encoding='utf-8-sig', newline='') as f:
        keys = list(final_results[0].keys())
        writer = csv.DictWriter(f, fieldnames=keys, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(final_results)

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    run()
