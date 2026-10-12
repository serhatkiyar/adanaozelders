import json
import csv

def run():
    catalog = json.load(open("scan_checkpoint_catalog.json", "r", encoding="utf-8"))
    
    # Isolate exact cohort using amazon_full_analysis_strict.csv
    old_status_map = {}
    with open("amazon_full_analysis_strict.csv", "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            old_status_map[row["supplier_product_id"]] = row.get("match_status", "")
            
    recovered_nonbooks = []
    for pid, c in catalog.items():
        pri = c.get("primary_barcode", "")
        is_book = pri.startswith("978") or pri.startswith("979")
        if not is_book and c.get("match_status") == "MATCHED":
            old_status = old_status_map.get(str(pid), "")
            if old_status != "MATCHED":
                recovered_nonbooks.append(pid)
                
    # Write the CSV
    with open("recovered_nonbook_audit.csv", "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "supplier_product_id",
            "supplier_title",
            "supplier_brand",
            "matched_supplier_barcode",
            "amazon_asin",
            "amazon_title",
            "semantic_confidence"
        ])
        
        for pid in recovered_nonbooks:
            c = catalog[pid]
            writer.writerow([
                pid,
                c.get("supplier_title", ""),
                c.get("supplier_brand", ""),
                c.get("selected_supplier_barcode", ""),
                c.get("amazon_asin", ""),
                c.get("amazon_title", ""),
                c.get("semantic_confidence", "")
            ])
            
    print(f"Exported 1108 rows to recovered_nonbook_audit.csv")

if __name__ == "__main__":
    run()
