import json
import csv
import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from amazon_analyzer.normalizer import normalize_identifier
from amazon_analyzer.client import call_sp_api
from amazon_analyzer.auth import MARKETPLACE_ID

CHK_CATALOG = "scan_checkpoint_catalog.json"
ENRICHED_CSV = r"C:\Users\kiyar\Desktop\adana-ozel-ders\backend\scripts\yildirim_multibarcode_enriched_2026_09_30.csv"

def chunk_list(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]

def get_identifier_type(b):
    if len(b) == 13: return "EAN"
    if len(b) == 12: return "UPC"
    if len(b) == 10: return "ISBN"
    return "EAN" # default fallback

def run():
    catalog = json.load(open(CHK_CATALOG, 'r', encoding='utf-8'))
    
    enriched = {}
    with open(ENRICHED_CSV, 'r', encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            enriched[r["supplier_product_id"]] = r
            
    not_found = []
    for pid, c in catalog.items():
        if c.get("match_status") == "NOT_FOUND":
            not_found.append(pid)
            
    # Breakdown
    stats = {
        "books_total": 0, "nonbooks_total": 0,
        "books_multi": 0, "nonbooks_multi": 0,
        "books_primary_valid": 0, "nonbooks_primary_valid": 0,
        "types": {"EAN": 0, "UPC": 0, "ISBN": 0, "OTHER": 0}
    }
    
    sample_books = []
    sample_nonbooks = []
    
    for pid in not_found:
        enr = enriched.get(pid, {})
        pri = enr.get("primary_barcode", "")
        all_b = [b for b in enr.get("all_barcodes", "").split("|") if b]
        is_book = pri.startswith("978") or pri.startswith("979")
        
        # Valid primary check
        _, _, is_valid = normalize_identifier(pri)
        has_multi = len(all_b) > 1
        
        t = get_identifier_type(pri)
        if is_valid:
            if t in stats["types"]: stats["types"][t] += 1
            else: stats["types"]["OTHER"] += 1
            
        if is_book:
            stats["books_total"] += 1
            if is_valid: stats["books_primary_valid"] += 1
            if has_multi: stats["books_multi"] += 1
            if len(sample_books) < 50: sample_books.append(pid)
        else:
            stats["nonbooks_total"] += 1
            if is_valid: stats["nonbooks_primary_valid"] += 1
            if has_multi: stats["nonbooks_multi"] += 1
            if len(sample_nonbooks) < 50: sample_nonbooks.append(pid)
            
    print("==================================================")
    print("1. NOT_FOUND BREAKDOWN")
    print("==================================================")
    print(f"Total NOT_FOUND: {len(not_found)}")
    print(f"Books NOT_FOUND: {stats['books_total']} (Primary Valid: {stats['books_primary_valid']}, Multi-Barcode: {stats['books_multi']})")
    print(f"Non-Books NOT_FOUND: {stats['nonbooks_total']} (Primary Valid: {stats['nonbooks_primary_valid']}, Multi-Barcode: {stats['nonbooks_multi']})")
    print("Identifier Types (Valid Primary):", stats["types"])
    
    # 100 Sample Test
    test_pids = sample_books + sample_nonbooks
    print(f"\nRunning Amazon SP-API Search on {len(test_pids)} deterministic sample items...")
    
    # Build a set of all valid alternative barcodes to query
    barcodes_to_query = set()
    pid_to_barcodes = {}
    
    for pid in test_pids:
        enr = enriched.get(pid, {})
        all_b = [b for b in enr.get("all_barcodes", "").split("|") if b]
        valid_b = []
        for b in all_b:
            norm_b, _, valid = normalize_identifier(b)
            if valid:
                valid_b.append(norm_b)
                barcodes_to_query.add(norm_b)
        pid_to_barcodes[pid] = valid_b

    # Group barcodes by Type (API requires uniform type per request)
    type_groups = {"EAN": [], "UPC": [], "ISBN": []}
    for b in list(barcodes_to_query):
        t = get_identifier_type(b)
        if t in type_groups:
            type_groups[t].append(b)
            
    amz_results = {}
    
    for id_type, b_list in type_groups.items():
        if not b_list: continue
        for batch in chunk_list(b_list, 20):
            try:
                idents = ",".join(batch)
                res = call_sp_api("GET", f"/catalog/2022-04-01/items", params={
                    "identifiers": idents,
                    "identifiersType": id_type,
                    "marketplaceIds": MARKETPLACE_ID,
                    "includedData": "summaries,identifiers"
                })
                items = res.get("items", [])
                for item in items:
                    # Amazon might return multiple identifiers. Check which one matched.
                    req_id = None
                    for ident in item.get("identifiers", []):
                        for m_id in ident.get("identifiers", []):
                            val = m_id.get("identifier")
                            if val in batch:
                                req_id = val
                                break
                        if req_id: break
                    
                    if not req_id: 
                        # Fallback if Amazon doesn't explicitly return the queried identifier
                        for b in batch:
                            if b in json.dumps(item):
                                req_id = b
                                break
                                
                    if req_id:
                        if req_id not in amz_results:
                            amz_results[req_id] = []
                        amz_results[req_id].append(item)
            except Exception as e:
                print(f"API Error for batch {batch}: {e}")
                
    # Evaluate Results
    recovered_books = 0
    recovered_nonbooks = 0
    
    print("\n==================================================")
    print("4. RECOVERY SAMPLE (100 Items)")
    print("==================================================")
    
    for i, pid in enumerate(test_pids, 1):
        enr = enriched.get(pid, {})
        title = catalog[pid].get("supplier_title", "")
        pri = enr.get("primary_barcode", "")
        valid_b = pid_to_barcodes[pid]
        
        found = False
        amz_items = []
        successful_b = None
        
        for b in valid_b:
            if b in amz_results:
                found = True
                amz_items = amz_results[b]
                successful_b = b
                break
                
        is_b = pri.startswith("978") or pri.startswith("979")
        if found:
            if is_b: recovered_books += 1
            else: recovered_nonbooks += 1
            
            amz_title = amz_items[0].get("summaries", [{}])[0].get("itemName", "")
            asin = amz_items[0].get("asin", "")
            print(f"[{i}] {title[:30]} | Pri: {pri} | Alts: {len(valid_b)} | Matched on: {successful_b} -> ASIN: {asin} ({amz_title[:20]})")
            
    print("\n==================================================")
    print("7. RESULTS")
    print("==================================================")
    print(f"Books Recovered in Sample: {recovered_books} / 50")
    print(f"Non-Books Recovered in Sample: {recovered_nonbooks} / 50")
    print("Conclusion on Bug:")
    if recovered_books > 0 or recovered_nonbooks > 0:
        print("YES, there is a systematic early-exit or skipped-alternative bug!")
    else:
        print("NO, the existing NOT_FOUND items are genuinely not in the Amazon Catalog.")

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    run()
