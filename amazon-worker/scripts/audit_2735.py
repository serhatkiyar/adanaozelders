import json
import csv
import sys

def run():
    catalog = json.load(open('scan_checkpoint_catalog.json', 'r', encoding='utf-8'))
    pricing_chk = json.load(open('scan_checkpoint_pricing.json', 'r', encoding='utf-8'))
    fees_chk = json.load(open('scan_checkpoint_fees_mfn.json', 'r', encoding='utf-8'))
    cost_chk = json.load(open('scan_checkpoint_cost.json', 'r', encoding='utf-8'))

    # Determine original REVIEW cohort (those with POSITIVE contribution but no 'semantic_confidence': 'HIGH')
    original_review = []
    
    for pid, c in catalog.items():
        if c.get("match_status") != "MATCHED": continue
        asin = c.get("amazon_asin")
        price = pricing_chk.get(asin, {}).get("amazon_price")
        fee = fees_chk.get(asin, {}).get("amazon_fee")
        cost_info = cost_chk.get(str(pid), {})
        cost = cost_info.get("supplier_cost_inc_vat")
        conf = cost_info.get("supplier_cost_confidence")
        
        contrib = None
        if price is not None and fee is not None and conf == "VERIFIED_LIVE" and cost is not None:
            pack = int(c.get("supplier_pack_quantity", 1))
            total_cost = cost * pack
            contrib = float(price) - float(fee) - total_cost

        # Identify positive contribution
        if price and fee and conf == "VERIFIED_LIVE" and cost and contrib > 0:
            if c.get("semantic_confidence") != "HIGH":
                original_review.append(pid)

    buckets = {
        'BOOK_TRUSTED_EXACT_ISBN': 0,
        'BOOK_TRUE_REVIEW': 0,
        'NONBOOK_TRUSTED_FROM_PERSISTED_AUDIT': 0,
        'NONBOOK_TRUE_REVIEW': 0,
        'UNKNOWN_NO_IDENTITY_EVIDENCE': 0
    }
    
    # We also verify the deterministic join via supplier_product_id string matching
    sem_conf_map = {}
    with open('recovered_nonbook_audit.csv', 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            sem_conf_map[str(row.get("supplier_product_id"))] = row.get("semantic_confidence")
            
    for pid in original_review:
        c = catalog[pid]
        pri = str(c.get("primary_barcode", ""))
        is_book = pri.startswith("978") or pri.startswith("979")
        sel_bc = str(c.get("selected_supplier_barcode", ""))
        
        if is_book:
            pack = int(c.get("supplier_pack_quantity", 1))
            if (sel_bc.startswith("978") or sel_bc.startswith("979")) and pack == 1:
                buckets['BOOK_TRUSTED_EXACT_ISBN'] += 1
            else:
                buckets['BOOK_TRUE_REVIEW'] += 1
        else:
            str_pid = str(pid)
            if str_pid in sem_conf_map:
                conf = sem_conf_map[str_pid]
                if conf == "HIGH":
                    # This should be 0 because HIGH items are already in AUTO
                    buckets['NONBOOK_TRUSTED_FROM_PERSISTED_AUDIT'] += 1
                else:
                    buckets['NONBOOK_TRUE_REVIEW'] += 1
            else:
                buckets['UNKNOWN_NO_IDENTITY_EVIDENCE'] += 1

    print("==================================================")
    print("2735 REVIEW COHORT BREAKDOWN (EXACT BUCKETS)")
    print("==================================================")
    print(f"INPUT                 : {len(original_review)}")
    print(f"BOOK_TRUSTED_EXACT_ISBN              : {buckets['BOOK_TRUSTED_EXACT_ISBN']}")
    print(f"BOOK_TRUE_REVIEW                     : {buckets['BOOK_TRUE_REVIEW']}")
    print(f"NONBOOK_TRUSTED_FROM_PERSISTED_AUDIT : {buckets['NONBOOK_TRUSTED_FROM_PERSISTED_AUDIT']}")
    print(f"NONBOOK_TRUE_REVIEW                  : {buckets['NONBOOK_TRUE_REVIEW']}")
    print(f"UNKNOWN_NO_IDENTITY_EVIDENCE         : {buckets['UNKNOWN_NO_IDENTITY_EVIDENCE']}")
    print("--------------------------------------------------")
    print(f"SUM                                  : {sum(buckets.values())}")
    
if __name__ == "__main__":
    run()
