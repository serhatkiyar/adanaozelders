import json
import csv
import sys
import os

CHK_CATALOG = 'scan_checkpoint_catalog.json'
CHK_PRICING = 'scan_checkpoint_pricing.json'
CHK_FEES = 'scan_checkpoint_fees_mfn.json'
CHK_COST = 'scan_checkpoint_cost.json'

def run():
    catalog = json.load(open(CHK_CATALOG, 'r', encoding='utf-8'))
    pricing_chk = json.load(open(CHK_PRICING, 'r', encoding='utf-8'))
    fees_chk = json.load(open(CHK_FEES, 'r', encoding='utf-8'))
    cost_chk = json.load(open(CHK_COST, 'r', encoding='utf-8'))

    # Load semantic confidence from older audits
    sem_conf_map = {}
    if os.path.exists('recovered_nonbook_audit.csv'):
        with open('recovered_nonbook_audit.csv', 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                pid = row.get("supplier_product_id")
                conf = row.get("semantic_confidence")
                if pid and conf:
                    sem_conf_map[str(pid)] = conf

    f_stats = {
        'AUTO': 0,
        'REVIEW': 0,
        'REJECT': 0,
        'FEE_INCOMPLETE': 0
    }
    
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

        # Evaluate Identity
        pri = c.get("primary_barcode", "")
        is_book = pri.startswith("978") or pri.startswith("979")
        sel_bc = c.get("selected_supplier_barcode", "")
        
        # 1. From Catalog
        catalog_conf = c.get("semantic_confidence")
        # 2. From CSV Map
        csv_conf = sem_conf_map.get(str(pid))
        
        sem_conf_is_high = (catalog_conf == "HIGH" or csv_conf == "HIGH")
        
        trusted_book = False
        if is_book and (sel_bc.startswith("978") or sel_bc.startswith("979")):
            pack = int(c.get("supplier_pack_quantity", 1))
            if pack == 1:
                trusted_book = True

        is_trusted_identity = sem_conf_is_high or trusted_book

        # Funnel Logic
        if price is None:
            f_stats['REJECT'] += 1
        elif fee is None:
            f_stats['FEE_INCOMPLETE'] += 1
        elif conf != "VERIFIED_LIVE" or cost is None:
            f_stats['REJECT'] += 1
        elif contrib is None or contrib <= 0:
            f_stats['REJECT'] += 1
        else:
            if is_trusted_identity:
                f_stats['AUTO'] += 1
            else:
                f_stats['REVIEW'] += 1

    print("\n--- NORMALIZED GLOBAL FUNNEL ---")
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
