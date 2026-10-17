import json
import csv
import re
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from amazon_analyzer.normalizer import normalize_identifier

SUPPLIER_CSV = r"C:\Users\kiyar\Desktop\iş kültür scrapping\outputs\guncel_stok_2026_09_30.csv"
ENRICHED_CSV = r"C:\Users\kiyar\Desktop\adana-ozel-ders\backend\scripts\yildirim_multibarcode_enriched_2026_09_30.csv"
CHK_CATALOG = "scan_checkpoint_catalog.json"

def run_diagnostics():
    # 1. Trace 66984
    cat = json.load(open(CHK_CATALOG, 'r', encoding='utf-8'))
    trace_66984 = cat.get("66984")
    
    # 2. Book Stats
    books_matched = 0
    books_not_found = 0
    books_ambig = 0
    
    non_books_matched = 0
    non_books_not_found = 0
    non_books_ambig = 0
    
    total_books = 0
    total_978_979 = 0
    
    categories = {}
    with open(SUPPLIER_CSV, 'r', encoding='utf-8-sig') as f:
        for row in csv.DictReader(f, delimiter=';'):
            categories[row.get("id")] = row.get("kategori", "").strip().upper()
            
    book_traces_matched = []
    book_traces_not_found = []
    
    not_found_output = []
    
    primary_matched = 0
    alt_matched = 0
            
    for pid, c in cat.items():
        is_book = categories.get(pid) == "KİTAP"
        if is_book:
            total_books += 1
            
        prim = c.get("primary_barcode", "")
        if prim.startswith("978") or prim.startswith("979"):
            total_978_979 += 1
            
        status = c.get("match_status")
        if status == "MATCHED":
            if is_book:
                books_matched += 1
                if len(book_traces_matched) < 10:
                    book_traces_matched.append(c)
            else:
                non_books_matched += 1
                
            if c.get("is_primary_barcode"):
                primary_matched += 1
            else:
                alt_matched += 1
        elif status == "NOT_FOUND":
            if is_book:
                books_not_found += 1
                if len(book_traces_not_found) < 10:
                    book_traces_not_found.append(c)
            else:
                non_books_not_found += 1
                
            norm, btype, valid = normalize_identifier(prim)
            if valid:
                not_found_output.append({
                    "supplier_product_id": pid,
                    "supplier_code": c.get("supplier_code"),
                    "supplier_title": c.get("supplier_title"),
                    "primary_barcode": prim,
                    "is_book": is_book
                })
        else:
            if is_book:
                books_ambig += 1
            else:
                non_books_ambig += 1

    # Write NOT FOUND audit
    with open("amazon_catalog_not_found_audit.csv", "w", encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=["supplier_product_id", "supplier_code", "supplier_title", "primary_barcode", "is_book"])
        writer.writeheader()
        writer.writerows(not_found_output)
        
    print("=== TRACE FOR 66984 ===")
    print(json.dumps(trace_66984, indent=2))
    
    print("\n=== BOOK STATS ===")
    print(f"Total Books in CSV: {total_books}")
    print(f"Barcodes starting with 978/979: {total_978_979}")
    print(f"Books Matched: {books_matched}")
    print(f"Books Not Found: {books_not_found}")
    print(f"Books Ambig: {books_ambig}")
    print(f"Book Match Rate: {books_matched / total_books * 100:.2f}%" if total_books else "N/A")
    
    print("\n=== NON-BOOK STATS ===")
    total_non_books = len(cat) - total_books
    print(f"Total Non-Books: {total_non_books}")
    print(f"Non-Books Matched: {non_books_matched}")
    print(f"Non-Books Not Found: {non_books_not_found}")
    print(f"Non-Books Ambig: {non_books_ambig}")
    print(f"Non-Book Match Rate: {non_books_matched / total_non_books * 100:.2f}%" if total_non_books else "N/A")
    
    print("\n=== MATCHING SOURCE ===")
    print(f"Matched from Primary Barcode: {primary_matched}")
    print(f"Matched from Alternative Barcode: {alt_matched}")
    
    print("\n=== 20 BOOK TRACE (10 MATCHED, 10 NOT FOUND) ===")
    print("--- MATCHED ---")
    for b in book_traces_matched:
        print(f"ID: {b['supplier_product_id']} | Title: {b['supplier_title'][:30]} | Amazon ASIN: {b['amazon_asin']} | Barcode Used: {b['selected_supplier_barcode']}")
    print("--- NOT FOUND ---")
    for b in book_traces_not_found:
        print(f"ID: {b['supplier_product_id']} | Title: {b['supplier_title'][:30]} | Primary Barcode: {b['primary_barcode']}")

if __name__ == "__main__":
    run_diagnostics()
