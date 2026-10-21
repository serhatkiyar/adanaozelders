import json
import csv

def run():
    # 1. Read old status from CSV
    old_status_map = {}
    with open("amazon_full_analysis_strict.csv", "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            old_status_map[row["supplier_product_id"]] = row.get("match_status", "")
            
    # 2. Read new status from JSON
    catalog_chk = json.load(open("scan_checkpoint_catalog.json", 'r', encoding='utf-8'))
    
    recovered_pids = []
    for pid, c in catalog_chk.items():
        new_status = c.get("match_status")
        old_status = old_status_map.get(pid, "")
        
        # In the CSV, NOT_FOUND might be blank or "NOT_FOUND" or "CATALOG_NOT_FOUND"
        if new_status == "MATCHED" and old_status != "MATCHED":
            recovered_pids.append(pid)
            
    print(f"Extracted EXACTLY {len(recovered_pids)} recovered PIDs from CSV comparison!")
    
    with open("recovered_1248_product_ids.json", "w", encoding="utf-8") as f:
        json.dump(recovered_pids, f)

if __name__ == "__main__":
    run()
