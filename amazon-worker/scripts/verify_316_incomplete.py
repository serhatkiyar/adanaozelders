"""
Verification script - READ ONLY, no data modification.

Goal: For the 316 original CATALOG_INCOMPLETE non-book products,
verify the final status breakdown and whether NOT_FOUND was assigned
legitimately (via successful API 0-result responses) or silently
from retry exhaustion.
"""
import json
import csv

CHK_CATALOG = "scan_checkpoint_catalog.json"
OLD_CSV = "amazon_full_analysis_strict.csv"
ENRICHED = "backend/scripts/yildirim_enriched_checkpoint.json"

def run():
    catalog = json.load(open(CHK_CATALOG, "r", encoding="utf-8"))
    enriched = json.load(open(ENRICHED, "r", encoding="utf-8"))

    # 1. Build old_status_map from CSV
    old_status_map = {}
    with open(OLD_CSV, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            old_status_map[row["supplier_product_id"]] = row.get("match_status", "")

    # 2. Identify the 316 original CATALOG_INCOMPLETE non-book PIDs
    # These are PIDs that were CATALOG_INCOMPLETE in the old CSV
    # AND are non-book
    original_316 = []
    for pid, c in catalog.items():
        pri = c.get("primary_barcode", "")
        is_book = pri.startswith("978") or pri.startswith("979")
        if is_book:
            continue
        old_st = old_status_map.get(str(pid), "")
        if old_st == "CATALOG_INCOMPLETE":
            original_316.append(pid)

    print(f"Original CATALOG_INCOMPLETE non-book PIDs found: {len(original_316)}")
    print(f"(Expected: 316)")

    # 3. For each of the 316, check their current status
    status_breakdown = {}
    for pid in original_316:
        current_st = catalog.get(pid, {}).get("match_status", "MISSING")
        status_breakdown[current_st] = status_breakdown.get(current_st, 0) + 1

    print("\nCurrent status breakdown of original 316:")
    for st, cnt in sorted(status_breakdown.items()):
        print(f"  {st}: {cnt}")

    # 4. Focus on the ones now marked NOT_FOUND
    now_not_found = [pid for pid in original_316
                     if catalog.get(pid, {}).get("match_status") == "NOT_FOUND"]
    now_matched = [pid for pid in original_316
                   if catalog.get(pid, {}).get("match_status") == "MATCHED"]
    still_incomplete = [pid for pid in original_316
                        if catalog.get(pid, {}).get("match_status") == "CATALOG_INCOMPLETE"]
    other = [pid for pid in original_316
             if catalog.get(pid, {}).get("match_status") not in
             ["NOT_FOUND", "MATCHED", "CATALOG_INCOMPLETE"]]

    print(f"\n--- BREAKDOWN ---")
    print(f"Previously CATALOG_INCOMPLETE : 316")
    print(f"  Now MATCHED                 : {len(now_matched)}")
    print(f"  Now NOT_FOUND               : {len(now_not_found)}")
    print(f"  Still CATALOG_INCOMPLETE    : {len(still_incomplete)}")
    print(f"  Other (conflict/review)     : {len(other)}")
    print(f"  SUM CHECK                   : {len(now_matched)+len(now_not_found)+len(still_incomplete)+len(other)} (must be 316)")

    # 5. KEY AUDIT: Can we prove the NOT_FOUND ones got successful responses?
    # The audit_nonbook_recovery.py logic set NOT_FOUND only when:
    #   state["failed"] == 0 AND state["pending"] == 0
    # This means: all identifier batches returned non-None responses,
    # but none matched. However, we did NOT persist per-PID response metadata.
    # Therefore we CANNOT prove it from existing checkpoint data alone.
    # We must re-query to confirm.
    print("\n--- PROOF AVAILABILITY ---")
    print(f"PIDs marked NOT_FOUND from retry logic : {len(now_not_found)}")
    print(f"Response metadata persisted in catalog  : NO")
    print(f"  (audit_nonbook_recovery.py did not store per-PID response proof)")
    print(f"Can we confirm 0-result from existing data? : NO")
    print(f"Re-query required to confirm             : YES ({len(now_not_found)} PIDs)")

    # 6. Check if any NOT_FOUND products still have identifiers to query
    print(f"\n--- SAMPLE NOT_FOUND products (first 10) ---")
    print(f"{'PID':<12} {'Title':<40} {'Primary Barcode':<20}")
    print("-" * 75)
    for pid in now_not_found[:10]:
        c = catalog[pid]
        enr = enriched.get(str(pid), enriched.get(pid, {}))
        title = c.get("supplier_title", "")[:38]
        pri = c.get("primary_barcode", "")
        barkodlar = enr.get("barkodlar", [])
        n_barcodes = len(barkodlar)
        print(f"{pid:<12} {title:<40} {pri:<20} ({n_barcodes} barcodes)")

    # 7. Other status (e.g. identity conflict/review from audit)
    if other:
        print(f"\n--- OTHER STATUS PIDs ---")
        for pid in other[:10]:
            print(f"  PID {pid}: {catalog[pid].get('match_status')}")

    print("\n=== CONCLUSION ===")
    print(f"85 (recovered) + {len(now_not_found)} (now NOT_FOUND) + {len(still_incomplete)} (still INCOMPLETE) + {len(other)} (other) = {len(now_matched)+len(now_not_found)+len(still_incomplete)+len(other)}")
    print(f"CATALOG_INCOMPLETE = 0 is {'UNVERIFIABLE' if len(now_not_found) > 0 else 'CONFIRMED'}")
    if len(now_not_found) > 0:
        print(f"  Reason: {len(now_not_found)} PIDs were set NOT_FOUND by audit_nonbook_recovery.py")
        print(f"  but no successful-200-response proof was persisted.")
        print(f"  To confirm: re-query these {len(now_not_found)} PIDs against Catalog API.")

if __name__ == "__main__":
    run()
