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
SUPPLIER_CSV = r"C:\Users\kiyar\Desktop\iş kültür scrapping\outputs\guncel_stok_2026_09_30.csv"

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
    
    # Load minimum order quantities
    moqs = {}
    with open(SUPPLIER_CSV, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f, delimiter=";"):
            pid = str(row.get("id", "")).strip()
            if pid:
                moq_val = row.get("min_siparis", 1)
                try:
                    moqs[pid] = int(moq_val)
                except ValueError:
                    moqs[pid] = 1

    auto_opportunities = []
    fee_incomplete_candidates = []
    
    for pid, c in catalog_chk.items():
        row = c.copy()
        asin = row.get("amazon_asin")
        is_book = row.get("primary_barcode", "").startswith("978") or row.get("primary_barcode", "").startswith("979")
        row["is_book"] = is_book
        
        p_info = pricing_chk.get(asin, {}) if asin else {}
        f_info_mfn = fees_mfn.get(asin, {}) if asin else {}
        cost_info = cost_chk.get(pid, {})
        
        price = p_info.get("amazon_price")
        fee = f_info_mfn.get("amazon_fee")
        
        cost = cost_info.get("supplier_cost_inc_vat")
        confidence = cost_info.get("supplier_cost_confidence")
        if confidence != "VERIFIED_LIVE": cost = None
            
        pack_val = row.get("supplier_pack_quantity")
        pack = int(pack_val) if pack_val else None
        pack_status = row.get("pack_quantity_status")
        is_primary = row.get("is_primary_barcode")
        
        row["amazon_price"] = price
        row["amazon_fee_mfn"] = fee
        row["supplier_cost_inc_vat"] = cost
        
        # 1. CATALOG
        if row.get("match_status") != "MATCHED": continue
        # 2. OFFER
        if not price: continue
        # 3. IDENTITY / PACK MISMATCH
        if pack_status == "MISMATCH": continue
            
        # 4. FEE
        if not fee:
            if cost: # Has verified live cost -> HIGH POTENTIAL FEE INCOMPLETE
                calc_cost = cost * (pack if pack else 1)
                row["gross_spread_before_fee"] = float(price) - calc_cost
                fee_incomplete_candidates.append(row)
            continue
            
        # 5. COST
        if cost is None: continue
        # 6. CALCULABLE
        if pack is None: continue
            
        # 7. PROFIT
        total_cost = cost * pack
        row["calculated_supplier_cost"] = total_cost
        contribution = round(float(price) - float(fee) - total_cost, 2)
        row["estimated_contribution_before_shipping"] = contribution
        
        if contribution <= 0: continue
            
        # 8. STRICT CLASSIFICATION
        margin_ratio = float(price) / total_cost if total_cost else 0
        is_auto = True
        
        if not is_primary and pack_status == "UNKNOWN" and not is_book:
            is_auto = False
            
        if is_book:
            sup_t = row.get("supplier_title")
            amz_t = row.get("amazon_title")
            if get_conflict_type(sup_t, amz_t) is not None or margin_ratio > 4.0:
                is_auto = False
        else:
            if pack_status == "UNKNOWN" or margin_ratio > 4.0:
                is_auto = False

        if is_auto:
            # COMMERCIAL FIELDS
            margin_pct = (contribution / float(price)) * 100
            row["contribution_margin_percent"] = margin_pct
            
            moq = moqs.get(pid, 1)
            row["min_order_quantity"] = moq
            
            # Cash required: We need to buy enough to fulfill at least one order OR meet MOQ.
            # Example: pack is 12, MOQ is 5. We must buy 12.
            # Example: pack is 1, MOQ is 5. We must buy 5.
            actual_min_buy = max(pack, moq)
            cash_required = actual_min_buy * cost
            row["minimum_purchase_cash_required"] = cash_required
            
            # Scenarios
            row["shipping_cost_scenario_50"] = contribution - 50
            row["shipping_cost_scenario_75"] = contribution - 75
            row["shipping_cost_scenario_100"] = contribution - 100
            row["shipping_cost_scenario_125"] = contribution - 125
            
            row["margin_scenario_50"] = ((contribution - 50) / float(price)) * 100
            row["margin_scenario_75"] = ((contribution - 75) / float(price)) * 100
            row["margin_scenario_100"] = ((contribution - 100) / float(price)) * 100
            row["margin_scenario_125"] = ((contribution - 125) / float(price)) * 100
            
            row["max_shipping_cost_before_loss"] = contribution
            
            # Capital efficiency
            row["contribution_per_1000_tl_capital"] = (contribution / total_cost) * 1000
            
            # Commercial label
            if contribution < 50 or margin_pct < 10:
                row["commercial_label"] = "LOW_VALUE_AUTO"
            else:
                row["commercial_label"] = "HIGH_VALUE_AUTO"
                
            auto_opportunities.append(row)

    # ASSERTION
    if len(auto_opportunities) != 1025:
        print(f"CRITICAL WARNING: Auto Opportunity count is {len(auto_opportunities)}, expected 1025!")
    else:
        print("ASSERTION PASSED: Exact 1,025 AUTO_OPPORTUNITY recovered.")

    if len(fee_incomplete_candidates) != 327:
        print(f"CRITICAL WARNING: Fee Incomplete count is {len(fee_incomplete_candidates)}, expected 327!")
    else:
        print("ASSERTION PASSED: Exact 327 FEE_INCOMPLETE candidates recovered.")

    # Sorts
    auto_opportunities.sort(key=lambda x: x["estimated_contribution_before_shipping"], reverse=True)
    
    books = [x for x in auto_opportunities if x["is_book"]]
    non_books = [x for x in auto_opportunities if not x["is_book"]]
    
    fee_incomplete_candidates.sort(key=lambda x: x["gross_spread_before_fee"], reverse=True)
    
    # Reports
    gt_100 = sum(1 for x in auto_opportunities if x["estimated_contribution_before_shipping"] > 100)
    gt_200 = sum(1 for x in auto_opportunities if x["estimated_contribution_before_shipping"] > 200)
    gt_500 = sum(1 for x in auto_opportunities if x["estimated_contribution_before_shipping"] > 500)
    
    margin_20 = sum(1 for x in auto_opportunities if x["contribution_margin_percent"] > 20)
    margin_30 = sum(1 for x in auto_opportunities if x["contribution_margin_percent"] > 30)
    
    pos_100_ship = sum(1 for x in auto_opportunities if x["shipping_cost_scenario_100"] > 0)
    pos_125_ship = sum(1 for x in auto_opportunities if x["shipping_cost_scenario_125"] > 0)
    
    print("\n==================================================")
    print("COMMERCIAL METRICS (1,025 AUTO)")
    print("==================================================")
    print(f"Contribution > 100 TL: {gt_100}")
    print(f"Contribution > 200 TL: {gt_200}")
    print(f"Contribution > 500 TL: {gt_500}")
    print(f"Margin > 20%         : {margin_20}")
    print(f"Margin > 30%         : {margin_30}")
    print(f"Positive with 100 TL Shipping: {pos_100_ship}")
    print(f"Positive with 125 TL Shipping: {pos_125_ship}")
    
    print("\n--- TOP 20 LOWEST CAPITAL REQUIRED ---")
    lowest_cap = sorted(auto_opportunities, key=lambda x: x["minimum_purchase_cash_required"])[:20]
    for x in lowest_cap:
        print(f"Capital: {x['minimum_purchase_cash_required']:.2f} TL | Contrib: {x['estimated_contribution_before_shipping']:.2f} TL | ASIN: {x['amazon_asin']}")

    print("\n--- TOP 20 BEST CAPITAL EFFICIENCY (Contrib per 1000 TL) ---")
    best_eff = sorted(auto_opportunities, key=lambda x: x["contribution_per_1000_tl_capital"], reverse=True)[:20]
    for x in best_eff:
        print(f"Efficiency: {x['contribution_per_1000_tl_capital']:.2f} TL per 1000 TL | Contrib: {x['estimated_contribution_before_shipping']:.2f} TL | ASIN: {x['amazon_asin']}")

    print("\n--- TOP 20 BOOKS (by Contribution TL) ---")
    for x in books[:20]:
        print(f"Contrib: {x['estimated_contribution_before_shipping']:.2f} TL | Margin: {x['contribution_margin_percent']:.1f}% | Title: {x.get('amazon_title')[:50]}...")

    print("\n--- TOP 20 NON-BOOKS (by Contribution TL) ---")
    for x in non_books[:20]:
        print(f"Contrib: {x['estimated_contribution_before_shipping']:.2f} TL | Margin: {x['contribution_margin_percent']:.1f}% | Title: {x.get('amazon_title')[:50]}...")
        
    print("\n--- TOP 20 FEE INCOMPLETE (by Gross Spread) ---")
    for x in fee_incomplete_candidates[:20]:
        print(f"Gross Spread: {x['gross_spread_before_fee']:.2f} TL | Title: {x.get('amazon_title')[:50]}...")
        
    # Save CSVs
    def save_csv(filename, data):
        if not data: return
        with open(filename, "w", encoding='utf-8-sig', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=list(data[0].keys()), extrasaction='ignore')
            writer.writeheader()
            writer.writerows(data)
            
    save_csv("commercial_auto_opportunities.csv", auto_opportunities)
    save_csv("commercial_top_books.csv", books[:50])
    save_csv("commercial_top_nonbooks.csv", non_books[:50])
    save_csv("fee_incomplete_high_potential.csv", fee_incomplete_candidates)

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    run()
