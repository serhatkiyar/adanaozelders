import json
import csv

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
    with open('recovered_nonbook_audit.csv', 'r', encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            pid = row.get("supplier_product_id")
            conf = row.get("semantic_confidence")
            if pid and conf:
                sem_conf_map[str(pid)] = conf

    metrics = {
        'TOTAL_MATCHED': 0,
        'ACTIVE_OFFER': 0,
        'VERIFIED_LIVE_COST': 0,
        'FEE_SUCCESS': 0,
        'FEE_INCOMPLETE': 0,
        'POSITIVE_CONTRIBUTION': 0,
        'AUTO': 0,
        'REVIEW': 0,
        'REJECT': 0
    }

    for pid, c in catalog.items():
        if c.get("match_status") != "MATCHED":
            continue
            
        metrics['TOTAL_MATCHED'] += 1

        asin = c.get("amazon_asin")
        price = pricing_chk.get(asin, {}).get("amazon_price")
        fee = fees_chk.get(asin, {}).get("amazon_fee")
        
        cost_info = cost_chk.get(str(pid), {})
        cost = cost_info.get("supplier_cost_inc_vat")
        conf = cost_info.get("supplier_cost_confidence")
        
        if price is not None:
            metrics['ACTIVE_OFFER'] += 1
            
        if cost is not None and conf == "VERIFIED_LIVE":
            metrics['VERIFIED_LIVE_COST'] += 1
            
        if fee is not None:
            metrics['FEE_SUCCESS'] += 1

        contrib = None
        if price is not None and fee is not None and conf == "VERIFIED_LIVE" and cost is not None:
            pack = int(c.get("supplier_pack_quantity", 1))
            total_cost = cost * pack
            contrib = float(price) - float(fee) - total_cost
            if contrib > 0:
                metrics['POSITIVE_CONTRIBUTION'] += 1

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
            metrics['REJECT'] += 1
        elif fee is None:
            metrics['FEE_INCOMPLETE'] += 1
        elif conf != "VERIFIED_LIVE" or cost is None:
            metrics['REJECT'] += 1
        elif contrib is None or contrib <= 0:
            metrics['REJECT'] += 1
        else:
            if is_trusted_identity:
                metrics['AUTO'] += 1
            else:
                metrics['REVIEW'] += 1

    print("\n==================================================")
    print("GLOBAL PIPELINE FUNNEL")
    print("==================================================")
    print(f"TOTAL_MATCHED            : {metrics['TOTAL_MATCHED']}")
    print(f"ACTIVE_OFFER             : {metrics['ACTIVE_OFFER']}")
    print(f"VERIFIED_LIVE_COST       : {metrics['VERIFIED_LIVE_COST']}")
    print(f"FEE_SUCCESS              : {metrics['FEE_SUCCESS']}")
    print(f"FEE_INCOMPLETE           : {metrics['TOTAL_MATCHED'] - metrics['FEE_SUCCESS']}")
    print(f"POSITIVE_CONTRIBUTION    : {metrics['POSITIVE_CONTRIBUTION']}")
    print("--------------------------------------------------")
    print(f"AUTO                     : {metrics['AUTO']} (kargo oncesi pozitif katkiya sahip trusted opportunity)")
    print(f"REVIEW                   : {metrics['REVIEW']}")
    print(f"REJECT                   : {metrics['REJECT']}")
    print(f"FEE_INCOMPLETE           : {metrics['FEE_INCOMPLETE']}")
    print("--------------------------------------------------")
    total_buckets = metrics['AUTO'] + metrics['REVIEW'] + metrics['REJECT'] + metrics['FEE_INCOMPLETE']
    print(f"SUM                      : {total_buckets} (Expected: {metrics['TOTAL_MATCHED']})")

if __name__ == "__main__":
    run()
