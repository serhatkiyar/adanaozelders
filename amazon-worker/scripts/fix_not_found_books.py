import json
import csv
import sys
import os
import time
import random
import traceback
from requests.exceptions import ReadTimeout, HTTPError

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from amazon_analyzer.normalizer import normalize_identifier
from amazon_analyzer.client import call_sp_api
from amazon_analyzer.auth import MARKETPLACE_ID

CHK_CATALOG = "scan_checkpoint_catalog.json"
ENRICHED_CSV = r"C:\Users\kiyar\Desktop\iş kültür scrapping\outputs\yildirim_multibarcode_enriched_2026_09_30.csv"
if not os.path.exists(ENRICHED_CSV):
    ENRICHED_CSV = r"C:\Users\kiyar\Desktop\adana-ozel-ders\backend\scripts\yildirim_multibarcode_enriched_2026_09_30.csv"

def extract_pack_quantity(title: str) -> int:
    if not title: return None
    import re
    m = re.search(r'\b(\d+)\s*(?:[\'’‘`]?\s*[Ll][IİııUÜüü]\b|ADET\b|PAR[ÇC]A\b|PACK\b|PCS\b)', title, re.IGNORECASE)
    if m: return int(m.group(1))
    m_pack = re.search(r'\bPACK\s+OF\s+(\d+)\b', title, re.IGNORECASE)
    if m_pack: return int(m_pack.group(1))
    return None

def run():
    catalog_chk = json.load(open(CHK_CATALOG, 'r', encoding='utf-8'))
    
    enriched = {}
    with open(ENRICHED_CSV, 'r', encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            enriched[r["supplier_product_id"]] = r
            
    # Target 2482 BOOK NOT_FOUND
    pids_to_recover = []
    for pid, c in catalog_chk.items():
        is_book = c.get("primary_barcode", "").startswith("978") or c.get("primary_barcode", "").startswith("979")
        if is_book and c.get("match_status") == "NOT_FOUND":
            pids_to_recover.append(pid)
            
    # Metrics
    stats = {
        "books_to_recover": len(pids_to_recover),
        "catalog_http_requests": 0,
        "catalog_retry_requests": 0,
        "catalog_429": 0,
        "catalog_timeout": 0,
        "catalog_5xx": 0,
        "recovered_matched": 0,
        "confirmed_not_found": 0,
        "catalog_incomplete": 0
    }
    
    def call_with_retry(idents, id_type="EAN"):
        max_retries = 5
        base_delay = 1.0
        
        for attempt in range(max_retries):
            stats["catalog_http_requests"] += 1
            try:
                res = call_sp_api("GET", f"/catalog/2022-04-01/items", params={
                    "identifiers": ",".join(idents),
                    "identifiersType": id_type,
                    "marketplaceIds": MARKETPLACE_ID,
                    "includedData": "summaries,identifiers"
                })
                return res
            except Exception as e:
                err_str = str(e).lower()
                is_429 = "429" in err_str or "too many requests" in err_str
                is_timeout = "timeout" in err_str or isinstance(e, ReadTimeout)
                is_5xx = "500" in err_str or "502" in err_str or "503" in err_str or "504" in err_str
                
                if is_429: stats["catalog_429"] += 1
                elif is_timeout: stats["catalog_timeout"] += 1
                elif is_5xx: stats["catalog_5xx"] += 1
                else:
                    # other error, possibly client error like 400. Still retry or break depending on strictness.
                    pass
                
                if attempt < max_retries - 1:
                    stats["catalog_retry_requests"] += 1
                    sleep_time = base_delay * (2 ** attempt) + random.uniform(0.1, 0.5)
                    time.sleep(sleep_time)
                else:
                    return None
                    
    def process_batch(pids, use_alternatives=False):
        # Map pids to the identifiers we want to query
        ident_to_pid = {}
        batch_idents = []
        
        for pid in pids:
            enr = enriched.get(pid, {})
            if not use_alternatives:
                # Use Primary Only
                pri = enr.get("primary_barcode", "")
                norm_pri, _, valid = normalize_identifier(pri)
                if valid:
                    ident_to_pid[norm_pri] = pid
                    batch_idents.append(norm_pri)
            else:
                # Use Alternatives (excluding primary)
                pri = enr.get("primary_barcode", "")
                norm_pri, _, _ = normalize_identifier(pri)
                all_b = [b for b in enr.get("all_barcodes", "").split("|") if b]
                alt_found = False
                for b in all_b:
                    norm_b, _, valid = normalize_identifier(b)
                    if valid and norm_b != norm_pri:
                        ident_to_pid[norm_b] = pid
                        batch_idents.append(norm_b)
                        alt_found = True
                        break # Just try the first valid alternative for now, to keep mapping 1:1 in this simple batch
                if not alt_found:
                    # No alternatives to try
                    pass
                    
        if not batch_idents:
            return {}, []
            
        # We can only request 20 at a time.
        results_map = {}
        failed_pids = []
        
        for i in range(0, len(batch_idents), 20):
            chunk = batch_idents[i:i+20]
            res = call_with_retry(chunk)
            
            if res is None:
                # Batch failed completely
                for b in chunk:
                    failed_pids.append(ident_to_pid[b])
            else:
                # Batch succeeded!
                items = res.get("items", [])
                
                # Map results to barcodes
                for item in items:
                    req_id = None
                    for ident in item.get("identifiers", []):
                        for m_id in ident.get("identifiers", []):
                            val = m_id.get("identifier")
                            if val in chunk:
                                req_id = val
                                break
                        if req_id: break
                        
                    if not req_id:
                        for b in chunk:
                            if b in json.dumps(item):
                                req_id = b
                                break
                                
                    if req_id:
                        if req_id not in results_map:
                            results_map[req_id] = []
                        results_map[req_id].append(item)
                        
                # Ensure all queried barcodes in chunk are initialized in results_map (even empty)
                for b in chunk:
                    if b not in results_map:
                        results_map[b] = []
                        
        # Now map results_map back to pids
        pid_outcomes = {}
        for b, items in results_map.items():
            pid = ident_to_pid[b]
            pid_outcomes[pid] = {"items": items, "queried_barcode": b}
            
        return pid_outcomes, failed_pids
        
    # Phase 1: Query Primary Barcodes
    print("Starting Phase 1: Primary EAN Queries...")
    primary_outcomes, primary_failed = process_batch(pids_to_recover, use_alternatives=False)
    
    pids_for_phase_2 = []
    
    # Process Primary Outcomes
    for pid, data in primary_outcomes.items():
        items = data["items"]
        if len(items) > 0:
            # Match found
            catalog_chk[pid]["match_status"] = "MATCHED"
            catalog_chk[pid]["selected_supplier_barcode"] = data["queried_barcode"]
            
            # Simple match selection (take first)
            title = items[0].get("summaries", [{}])[0].get("itemName", "")
            asin = items[0].get("asin")
            amz_pack = extract_pack_quantity(title)
            
            catalog_chk[pid]["amazon_asin"] = asin
            catalog_chk[pid]["amazon_title"] = title
            
            # Carpan check
            enr = enriched.get(pid, {})
            p_barcodes = enr.get("all_barcodes", "").split("|")
            p_multis = enr.get("all_multipliers", "").split("|")
            carpan = 1
            for b, m in zip(p_barcodes, p_multis):
                norm_b, _, _ = normalize_identifier(b)
                if norm_b == data["queried_barcode"]:
                    try: carpan = int(m)
                    except: pass
                    
            catalog_chk[pid]["supplier_pack_quantity"] = carpan
            catalog_chk[pid]["is_primary_barcode"] = True
            
            if amz_pack == carpan: catalog_chk[pid]["pack_quantity_status"] = "MATCH"
            elif amz_pack is None: catalog_chk[pid]["pack_quantity_status"] = "UNKNOWN"
            else: catalog_chk[pid]["pack_quantity_status"] = "MISMATCH"
            
            stats["recovered_matched"] += 1
        else:
            # 0 items returned for primary. Valid 0-result. Move to Phase 2 if alternatives exist
            enr = enriched.get(pid, {})
            all_b = [b for b in enr.get("all_barcodes", "").split("|") if b]
            if len(all_b) > 1:
                pids_for_phase_2.append(pid)
            else:
                # Truly Not Found
                catalog_chk[pid]["match_status"] = "NOT_FOUND"
                stats["confirmed_not_found"] += 1
                
    for pid in primary_failed:
        catalog_chk[pid]["match_status"] = "CATALOG_INCOMPLETE"
        stats["catalog_incomplete"] += 1
        
    # Phase 2: Query Alternative Barcodes
    print(f"Starting Phase 2: Alternative Barcode Queries ({len(pids_for_phase_2)} items)...")
    alt_outcomes, alt_failed = process_batch(pids_for_phase_2, use_alternatives=True)
    
    for pid, data in alt_outcomes.items():
        items = data["items"]
        if len(items) > 0:
            catalog_chk[pid]["match_status"] = "MATCHED"
            catalog_chk[pid]["selected_supplier_barcode"] = data["queried_barcode"]
            
            title = items[0].get("summaries", [{}])[0].get("itemName", "")
            asin = items[0].get("asin")
            amz_pack = extract_pack_quantity(title)
            
            catalog_chk[pid]["amazon_asin"] = asin
            catalog_chk[pid]["amazon_title"] = title
            
            enr = enriched.get(pid, {})
            p_barcodes = enr.get("all_barcodes", "").split("|")
            p_multis = enr.get("all_multipliers", "").split("|")
            carpan = 1
            for b, m in zip(p_barcodes, p_multis):
                norm_b, _, _ = normalize_identifier(b)
                if norm_b == data["queried_barcode"]:
                    try: carpan = int(m)
                    except: pass
                    
            catalog_chk[pid]["supplier_pack_quantity"] = carpan
            catalog_chk[pid]["is_primary_barcode"] = False
            
            if amz_pack == carpan: catalog_chk[pid]["pack_quantity_status"] = "MATCH"
            elif amz_pack is None: catalog_chk[pid]["pack_quantity_status"] = "UNKNOWN"
            else: catalog_chk[pid]["pack_quantity_status"] = "MISMATCH"
            
            stats["recovered_matched"] += 1
        else:
            catalog_chk[pid]["match_status"] = "NOT_FOUND"
            stats["confirmed_not_found"] += 1
            
    for pid in alt_failed:
        catalog_chk[pid]["match_status"] = "CATALOG_INCOMPLETE"
        stats["catalog_incomplete"] += 1
        
    # Check if any original items were completely skipped due to invalid barcodes (they shouldn't if they were 13-digit valid)
    for pid in pids_to_recover:
        if catalog_chk[pid]["match_status"] not in ["MATCHED", "NOT_FOUND", "CATALOG_INCOMPLETE"]:
            # If for some reason a barcode was totally invalid and skipped mapping
            catalog_chk[pid]["match_status"] = "NOT_FOUND"
            stats["confirmed_not_found"] += 1

    # Save checkpoint
    with open(CHK_CATALOG, "w", encoding="utf-8") as f:
        json.dump(catalog_chk, f, indent=2, ensure_ascii=False)

    total_books_matched = sum(1 for c in catalog_chk.values() if (c.get("primary_barcode", "").startswith("978") or c.get("primary_barcode", "").startswith("979")) and c.get("match_status") == "MATCHED")
    total_matched = sum(1 for c in catalog_chk.values() if c.get("match_status") == "MATCHED")
    
    # Assert
    total_processed = stats["recovered_matched"] + stats["confirmed_not_found"] + stats["catalog_incomplete"]
    print("\n==================================================")
    print("ROOT CAUSE ANALYSIS")
    print("==================================================")
    print("Found Bug in previous script `book_recovery.py`:")
    print("1. When an SP-API call throws an Exception (e.g., 429 Too Many Requests or Timeout), the exception block simply logs and continues.")
    print("2. The queried identifiers from that failed batch are NOT added to the `recovered_items_map`.")
    print("3. Later, the script maps results to products: if `candidates` is empty (which it is for failed batches), it defaults `match_status` to 'NOT_FOUND'.")
    print("4. This unconditional overwrite changes potentially matched items into 'NOT_FOUND' instead of 'CATALOG_INCOMPLETE'.\n")

    print("==================================================")
    print("RECOVERY METRICS")
    print("==================================================")
    print(f"books_to_recover         : {stats['books_to_recover']}")
    print(f"catalog_http_requests    : {stats['catalog_http_requests']}")
    print(f"catalog_retry_requests   : {stats['catalog_retry_requests']}")
    print(f"catalog_429              : {stats['catalog_429']}")
    print(f"catalog_timeout          : {stats['catalog_timeout']}")
    print(f"catalog_5xx              : {stats['catalog_5xx']}")
    print("-" * 30)
    print(f"recovered_matched        : {stats['recovered_matched']}")
    print(f"confirmed_not_found      : {stats['confirmed_not_found']}")
    print(f"catalog_incomplete       : {stats['catalog_incomplete']}")
    
    print(f"\nAssertion: {stats['recovered_matched']} + {stats['confirmed_not_found']} + {stats['catalog_incomplete']} = {total_processed} (Expected: {stats['books_to_recover']})")
    if total_processed == stats['books_to_recover']:
        print("ASSERTION PASSED!")
    else:
        print("ASSERTION FAILED!")
        
    print("\n==================================================")
    print("NEW OVERALL STATS")
    print("==================================================")
    print(f"New Total Book Matched   : {total_books_matched}")
    print(f"New Total Overall Matched: {total_matched}")

    print("\n==================================================")
    print("SAMPLE OF 30 NEWLY RECOVERED BOOKS")
    print("==================================================")
    sample = [c for pid, c in catalog_chk.items() if pid in pids_to_recover and c.get("match_status") == "MATCHED"][:30]
    for s in sample:
        print(f"Title: {s.get('supplier_title')[:35].ljust(35)} | EAN: {s.get('primary_barcode')} | ASIN: {s.get('amazon_asin')} | Amz Title: {s.get('amazon_title')[:30]}")

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    run()
