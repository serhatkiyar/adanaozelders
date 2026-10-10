import json
import time
import os
import random
import sys
from requests.exceptions import ReadTimeout

# Adjust sys.path so we can import backend modules
sys.path.append(os.path.abspath("backend"))
from amazon_analyzer.client import call_sp_api

CHK_CATALOG = "scan_checkpoint_catalog.json"
CHK_ENRICHED = "backend/scripts/yildirim_enriched_checkpoint.json"
MARKETPLACE_ID = "A33AVAJ2PDY3EV"  # Turkey

def get_all_identifiers(barcodes_str):
    # Returns a list of (ident_str, id_type, original_raw)
    result = []
    if not barcodes_str: return result
    
    raw_list = barcodes_str.split("|")
    seen = set()
    
    def add(ident, t, raw):
        if ident not in seen:
            seen.add(ident)
            result.append((ident, t, raw))
            
    for raw in raw_list:
        b = raw.strip()
        if not b: continue
        clean = ''.join(c for c in b if c.isdigit() or c.upper() == 'X')
        
        if len(clean) == 13:
            add(clean, "EAN", raw)
        elif len(clean) == 12:
            add(clean, "UPC", raw)
            add("0" + clean, "EAN", raw)
        elif len(clean) == 10:
            add(clean, "ISBN", raw)
        elif len(clean) == 8:
            add(clean, "EAN", raw)
            
    return result

def extract_pack_quantity(amazon_title):
    import re
    if not amazon_title: return None
    patterns = [
        r'\b(\d+)\s*(?:[aA]det|[lL][iİıi]|[lL][üÜuU]|[pP]aket|[kK]utu)\b',
        r'(?:[xX\*])\s*(\d+)\b',
        r'\b(\d+)\s*(?:[xX\*])',
        r'\b(?:[sS]et|[tT]ak[ıi]m)\s*(?:of)?\s*(\d+)\b',
        r'\b(\d+)\'l[iİıi]\b',
        r'\b(\d+)\'l[üÜuU]\b'
    ]
    for p in patterns:
        m = re.search(p, amazon_title)
        if m: return int(m.group(1))
    return None

def call_with_retry(idents, id_type, stats):
    max_retries = 6
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
            
            if is_429 or is_timeout or is_5xx:
                delay = base_delay * (2 ** attempt) + random.uniform(0.1, 0.5)
                stats["catalog_retry_requests"] += 1
                time.sleep(delay)
            else:
                return None # Unrecoverable error
    return None # Exhausted retries

def chunk_list(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]

def run():
    catalog = json.load(open(CHK_CATALOG, "r", encoding="utf-8"))
    enriched = json.load(open(CHK_ENRICHED, "r", encoding="utf-8"))
    
    # Target: NON-BOOK, match_status in ["NOT_FOUND", "CATALOG_INCOMPLETE"]
    target_pids = []
    for pid, c in catalog.items():
        primary = c.get("primary_barcode", "")
        status = c.get("match_status", "NOT_FOUND")
        is_book = primary.startswith("978") or primary.startswith("979")
        
        if not is_book and status in ["NOT_FOUND", "CATALOG_INCOMPLETE"]:
            target_pids.append(pid)
            
    print(f"Targeting {len(target_pids)} NON-BOOK NOT_FOUND/INCOMPLETE products.")
    
    # Prepare all queries
    # Group by id_type -> list of (ident_str, pid, is_primary, carpan)
    queries = {"EAN": [], "UPC": [], "ISBN": []}
    
    pid_states = {}
    
    for pid in target_pids:
        enr = enriched.get(str(pid), {})  # Note: PID might be string in catalog but int in enriched
        if not enr:
            enr = enriched.get(int(pid), {}) if str(pid).isdigit() else {}
            
        pri_raw = str(enr.get("primary_barcode", "")).strip()
        barkodlar = enr.get("barkodlar", [])
        
        carpan_map = {}
        all_raw_list = []
        
        # If barkodlar is empty, at least try the primary
        if not barkodlar and pri_raw:
            barkodlar = [{"barkod": pri_raw, "carpan": 1}]
            
        for b_obj in barkodlar:
            b_str = str(b_obj.get("barkod", "")).strip()
            if b_str:
                all_raw_list.append(b_str)
                try: carpan_map[b_str] = int(b_obj.get("carpan", 1))
                except: carpan_map[b_str] = 1
                
        all_raw = "|".join(all_raw_list)
        all_idents = get_all_identifiers(all_raw)
        
        if not all_idents:
            # Utterly invalid barcodes
            pid_states[pid] = {"status": "NOT_FOUND", "best_match": None, "pending": 0, "failed": 0}
            continue
            
        pid_states[pid] = {"status": "NOT_FOUND", "best_match": None, "pending": len(all_idents), "failed": 0}
        
        for ident, t, raw in all_idents:
            is_pri = (raw == pri_raw)
            c = carpan_map.get(raw, 1)
            if t in queries:
                queries[t].append((ident, pid, is_pri, c))
                
    stats = {
        "catalog_http_requests": 0, "catalog_retry_requests": 0,
        "catalog_429": 0, "catalog_timeout": 0, "catalog_5xx": 0,
        "PRIMARY_BARCODE_RECOVERED": 0,
        "ALTERNATIVE_BARCODE_RECOVERED": 0,
        "TOTAL_NONBOOK_RECOVERED": 0,
        "CONFIRMED_NOT_FOUND": 0,
        "CATALOG_INCOMPLETE": 0
    }
    
    # Process queries by type
    for id_type, items in queries.items():
        if not items: continue
        print(f"Processing {len(items)} {id_type} queries...")
        
        # Deduplicate identical idents within the same batch to save API calls
        unique_idents = list(set([x[0] for x in items]))
        
        # Map ident -> list of (pid, is_pri, carpan)
        ident_to_tasks = {}
        for ident, pid, is_pri, carpan in items:
            if ident not in ident_to_tasks: ident_to_tasks[ident] = []
            ident_to_tasks[ident].append((pid, is_pri, carpan))
            
        for chunk in chunk_list(unique_idents, 20):
            res = call_with_retry(chunk, id_type, stats)
            
            if res is None:
                # Batch failed completely
                for ident in chunk:
                    for pid, _, _ in ident_to_tasks[ident]:
                        pid_states[pid]["failed"] += 1
                        pid_states[pid]["pending"] -= 1
                continue
                
            # Process results
            items_returned = res.get("items", [])
            # Group items_returned by the identifier we queried.
            # SP-API returns a list of items, each item has 'identifiers'.
            # It's tricky to map exactly back, but we can look for our requested ident inside item['identifiers']
            
            # Create a lookup: requested_ident -> list of matched amazon items
            res_map = {i: [] for i in chunk}
            for amz_item in items_returned:
                for amz_id in amz_item.get("identifiers", []):
                    # Check EANs, UPCs, etc.
                    for m_id in amz_id.get("identifiers", []):
                        val = m_id.get("identifier")
                        if val in res_map:
                            res_map[val].append(amz_item)
                            
            # Resolve tasks
            for ident in chunk:
                matched_items = res_map[ident]
                for pid, is_pri, carpan in ident_to_tasks[ident]:
                    pid_states[pid]["pending"] -= 1
                    if matched_items:
                        # Found a match! If we already have a primary match, don't overwrite.
                        # If we have an alternative match, and this is primary, overwrite!
                        # We want Primary matches to take precedence over alternative matches.
                        current_best = pid_states[pid]["best_match"]
                        
                        # Just take the first item for simplicity
                        amz = matched_items[0]
                        title = amz.get("summaries", [{}])[0].get("itemName", "")
                        asin = amz.get("asin")
                        amz_pack = extract_pack_quantity(title)
                        
                        pack_status = "UNKNOWN"
                        if amz_pack == carpan: pack_status = "MATCH"
                        elif amz_pack is not None: pack_status = "MISMATCH"
                        
                        match_obj = {
                            "asin": asin,
                            "title": title,
                            "queried_barcode": ident,
                            "carpan": carpan,
                            "is_primary": is_pri,
                            "pack_status": pack_status
                        }
                        
                        if current_best is None:
                            pid_states[pid]["best_match"] = match_obj
                            pid_states[pid]["status"] = "MATCHED"
                        else:
                            # Precedence: Primary > Alternative. 
                            # If current is alternative and new is primary, overwrite.
                            # Also, Exact Pack > Mismatch
                            cur_pri = current_best["is_primary"]
                            if is_pri and not cur_pri:
                                pid_states[pid]["best_match"] = match_obj
                            elif is_pri == cur_pri:
                                if pack_status == "MATCH" and current_best["pack_status"] != "MATCH":
                                    pid_states[pid]["best_match"] = match_obj
                                    
                    else:
                        # 0 items for this specific identifier
                        pass

    # Finalize Catalog Checkpoint
    recovered_samples = []
    
    for pid, state in pid_states.items():
        if state["status"] == "MATCHED":
            stats["TOTAL_NONBOOK_RECOVERED"] += 1
            if state["best_match"]["is_primary"]:
                stats["PRIMARY_BARCODE_RECOVERED"] += 1
            else:
                stats["ALTERNATIVE_BARCODE_RECOVERED"] += 1
                
            c = catalog[pid]
            c["match_status"] = "MATCHED"
            c["amazon_asin"] = state["best_match"]["asin"]
            c["amazon_title"] = state["best_match"]["title"]
            c["selected_supplier_barcode"] = state["best_match"]["queried_barcode"]
            c["supplier_pack_quantity"] = state["best_match"]["carpan"]
            c["is_primary_barcode"] = state["best_match"]["is_primary"]
            c["pack_quantity_status"] = state["best_match"]["pack_status"]
            
            if len(recovered_samples) < 30:
                recovered_samples.append({
                    "supplier_title": c.get("supplier_title", ""),
                    "primary_barcode": c.get("primary_barcode", ""),
                    "matched_barcode": state["best_match"]["queried_barcode"],
                    "unit": state["best_match"]["carpan"],
                    "asin": state["best_match"]["asin"],
                    "amazon_title": state["best_match"]["title"]
                })
        else:
            # Not matched. Check if any requests failed
            if state["failed"] > 0:
                stats["CATALOG_INCOMPLETE"] += 1
                catalog[pid]["match_status"] = "CATALOG_INCOMPLETE"
            else:
                stats["CONFIRMED_NOT_FOUND"] += 1
                catalog[pid]["match_status"] = "NOT_FOUND"
                
    # Save Catalog
    with open(CHK_CATALOG, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
        
    # Calculate New Global Totals
    total_matched = sum(1 for c in catalog.values() if c.get("match_status") == "MATCHED")
    total_products = len(catalog)
    
    with open("recover_non_book.log", "w", encoding="utf-8") as f_log:
        def lprint(*args, **kwargs):
            print(*args, **kwargs)
            print(*args, file=f_log, **kwargs)
            f_log.flush()
            
        lprint("\n==================================================")
        lprint("NON-BOOK RECOVERY RESULTS")
        lprint("==================================================")
        lprint(f"NONBOOK_TO_RECOVER              : {len(target_pids)}")
        lprint(f"PRIMARY_BARCODE_RECOVERED       : {stats['PRIMARY_BARCODE_RECOVERED']}")
        lprint(f"ALTERNATIVE_BARCODE_RECOVERED   : {stats['ALTERNATIVE_BARCODE_RECOVERED']}")
        lprint(f"TOTAL_NONBOOK_RECOVERED         : {stats['TOTAL_NONBOOK_RECOVERED']}")
        lprint(f"CONFIRMED_NOT_FOUND             : {stats['CONFIRMED_NOT_FOUND']}")
        lprint(f"CATALOG_INCOMPLETE              : {stats['CATALOG_INCOMPLETE']}")
        lprint(f"\nAPI Stats: HTTP={stats['catalog_http_requests']}, 429={stats['catalog_429']}, 5xx={stats['catalog_5xx']}, Timeouts={stats['catalog_timeout']}")
        
        lprint("\n==================================================")
        lprint("NEW GLOBAL STATS")
        lprint("==================================================")
        lprint(f"NEW TOTAL MATCHED               : {total_matched}")
        lprint(f"NEW OVERALL MATCH RATE          : {(total_matched / total_products) * 100:.2f}%")
        
        lprint("\n==================================================")
        lprint("SAMPLE OF 30 RECOVERED NON-BOOKS")
        lprint("==================================================")
        for s in recovered_samples:
            lprint(f"SupTitle : {s['supplier_title'][:30]}")
            lprint(f"Primary  : {s['primary_barcode']}")
            lprint(f"Matched  : {s['matched_barcode']} (Carpan: {s['unit']})")
            lprint(f"ASIN     : {s['asin']}")
            lprint(f"AmzTitle : {s['amazon_title'][:40]}\n")

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    run()
