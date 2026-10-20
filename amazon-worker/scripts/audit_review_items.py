import json
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

    # First, let's identify the 2735 REVIEW products with positive contribution
    review_pids = []
    
    # Track the whole funnel explicitly
    f_stats = {
        'AUTO': 0,
        'REVIEW': 0,
        'REJECT': 0,
        'FEE_INCOMPLETE': 0
    }
    
    pos_contrib_pids = []

    for pid, c in catalog.items():
        if c.get("match_status") != "MATCHED":
            continue

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

        if price is None:
            f_stats['REJECT'] += 1
        elif fee is None:
            f_stats['FEE_INCOMPLETE'] += 1
        elif conf != "VERIFIED_LIVE" or cost is None:
            f_stats['REJECT'] += 1
        elif contrib is None or contrib <= 0:
            f_stats['REJECT'] += 1
        else:
            # Positive contribution!
            pos_contrib_pids.append((pid, c, contrib))
            if c.get("semantic_confidence") == "HIGH":
                f_stats['AUTO'] += 1
            else:
                f_stats['REVIEW'] += 1
                review_pids.append(pid)

    # 1. How many of the 2735 REVIEW products are BOOKS?
    books = 0
    non_books = 0
    
    # 2. Semantic confidence distribution
    sem_conf_dist = {
        "HIGH": 0,
        "MEDIUM": 0,
        "missing/null": 0,
        "other": 0
    }
    
    # 3. Trusted Book Logic Evidence
    trusted_book_count = 0
    true_identity_review_count = 0
    missing_field_only = 0
    
    for pid in review_pids:
        c = catalog[pid]
        pri = c.get("primary_barcode", "")
        is_book = pri.startswith("978") or pri.startswith("979")
        
        if is_book:
            books += 1
        else:
            non_books += 1
            
        sem_conf = c.get("semantic_confidence")
        if sem_conf == "HIGH":
            sem_conf_dist["HIGH"] += 1
        elif sem_conf == "MEDIUM":
            sem_conf_dist["MEDIUM"] += 1
        elif not sem_conf:
            sem_conf_dist["missing/null"] += 1
        else:
            sem_conf_dist["other"] += 1

        # Evaluate trusted book logic
        # 13-digit exact match: is_primary_barcode is True or selected_supplier_barcode starts with 978/979
        sel_bc = c.get("selected_supplier_barcode", "")
        exact_book = False
        if is_book and (sel_bc.startswith("978") or sel_bc.startswith("979")):
            # It's a book matched by its exact ISBN.
            # Was there a quantity conflict?
            pack = int(c.get("supplier_pack_quantity", 1))
            if pack == 1: # Assuming single book for now
                exact_book = True

        if exact_book:
            trusted_book_count += 1
            missing_field_only += 1
        else:
            # Non-book or non-exact book
            true_identity_review_count += 1
            
    print("--- AUDIT RESULTS ---")
    print(f"Total POSITIVE_CONTRIBUTION: {len(pos_contrib_pids)}")
    print(f"Total REVIEW from them     : {len(review_pids)}")
    print(f"1. Books in REVIEW         : {books}")
    print(f"   Non-books in REVIEW     : {non_books}")
    print(f"2. Semantic Confidence:")
    for k, v in sem_conf_dist.items():
        print(f"   - {k}: {v}")
    print(f"3. Trusted BOOK logic met  : {trusted_book_count}")
    print(f"4. True identity review    : {true_identity_review_count}")
    print(f"5. Missing field only      : {missing_field_only} (These are trusted books missing semantic_confidence=HIGH)")

    # Recalculate AUTO / REVIEW using the normalized logic
    # Normalized logic:
    # TRUSTED_IDENTITY = semantic_confidence == HIGH OR trusted BOOK_EXACT_ISBN
    
    new_auto = 0
    new_review = 0
    
    for pid, c, contrib in pos_contrib_pids:
        pri = c.get("primary_barcode", "")
        is_book = pri.startswith("978") or pri.startswith("979")
        sel_bc = c.get("selected_supplier_barcode", "")
        
        sem_conf = c.get("semantic_confidence") == "HIGH"
        
        trusted_book = False
        if is_book and (sel_bc.startswith("978") or sel_bc.startswith("979")):
            pack = int(c.get("supplier_pack_quantity", 1))
            if pack == 1:
                trusted_book = True
                
        if sem_conf or trusted_book:
            new_auto += 1
        else:
            new_review += 1

    print("\n--- RECALCULATED FUNNEL ---")
    print(f"POSITIVE_CONTRIBUTION      : {len(pos_contrib_pids)}")
    print(f"TRUSTED_POSITIVE (AUTO)    : {new_auto}")
    print(f"TRUE_IDENTITY_REVIEW       : {new_review}")
    
    print("\nOverall updated funnel counts:")
    print(f"AUTO                     : {new_auto}")
    print(f"REVIEW                   : {new_review}")
    print(f"REJECT                   : {f_stats['REJECT']}")
    print(f"FEE_INCOMPLETE           : {f_stats['FEE_INCOMPLETE']}")
    print(f"SUM                      : {new_auto + new_review + f_stats['REJECT'] + f_stats['FEE_INCOMPLETE']}")

if __name__ == "__main__":
    run()
