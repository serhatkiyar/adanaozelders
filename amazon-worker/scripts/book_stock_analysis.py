import json
import csv
import statistics
import re
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

CHK_CATALOG = "scan_checkpoint_catalog.json"
CHK_PRICING = "scan_checkpoint_pricing.json"
CHK_FEES_MFN = "scan_checkpoint_fees_mfn.json"
CHK_COST = "scan_checkpoint_cost.json"
SUPPLIER_CSV = r"C:\Users\kiyar\Desktop\iş kültür scrapping\outputs\guncel_stok_2026_09_30.csv"

def get_conflict_type(sup_title, amz_title):
    sup = sup_title.upper() if sup_title else ""
    amz = amz_title.upper() if amz_title else ""
    kw_set = r'\b(SET|TAKIM|KUTULU(?:\s*SET)?|BOX\s*SET|B[Iİıi]R\s*ARADA|X[2-9])\b'
    if re.search(kw_set, sup) or re.search(kw_set, amz): return "SET_KEYWORD"
    kw_qty = r'\b([2-9]|\d{2,})\s*(K[Iİıi]TAP|C[Iİıi]LT)\b'
    if re.search(kw_qty, sup) or re.search(kw_qty, amz): return "MULTI_QTY_KEYWORD"
    kw_vol = r'\b(C[Iİıi]LT|VOL(?:UME)?)\s*(\d+)\b'
    if re.search(kw_vol, sup) or re.search(kw_vol, amz): return "VOLUME_KEYWORD"
    return None

def run():
    supplier_info = {}
    with open(SUPPLIER_CSV, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f, delimiter=";"):
            pid = str(row.get("id", "")).strip()
            if pid:
                try: moq = int(row.get("min_siparis", 1) or 1)
                except ValueError: moq = 1
                
                stok_str = row.get("stok", "0").replace(",", ".")
                try: stok = int(float(stok_str))
                except ValueError: stok = 0
                
                supplier_info[pid] = {"moq": moq, "stok": stok}

    catalog_chk = json.load(open(CHK_CATALOG, 'r', encoding='utf-8'))
    pricing_chk = json.load(open(CHK_PRICING, 'r', encoding='utf-8'))
    fees_mfn = json.load(open(CHK_FEES_MFN, 'r', encoding='utf-8'))
    cost_chk = json.load(open(CHK_COST, 'r', encoding='utf-8'))

    books = []

    for pid, cat in catalog_chk.items():
        is_book = cat.get("primary_barcode", "").startswith("978") or cat.get("primary_barcode", "").startswith("979")
        if not is_book: continue
        
        asin = cat.get("amazon_asin")
        if not asin: continue
            
        p_info = pricing_chk.get(asin, {})
        f_info_mfn = fees_mfn.get(asin, {})
        cost_info = cost_chk.get(pid, {})
        
        price = p_info.get("amazon_price")
        fee = f_info_mfn.get("amazon_fee")
        cost = cost_info.get("supplier_cost_inc_vat")
        conf = cost_info.get("supplier_cost_confidence")
        pack_val = cat.get("supplier_pack_quantity")
        
        if not (price and fee and cost and conf == "VERIFIED_LIVE" and pack_val): continue
        if cat.get("pack_quantity_status") == "MISMATCH": continue
            
        pack = int(pack_val)
        total_cost = cost * pack
        contribution = round(float(price) - float(fee) - total_cost, 2)
        
        if contribution <= 0: continue
            
        sup_t = cat.get("supplier_title", "")
        amz_t = cat.get("amazon_title", "")
        margin_ratio = float(price) / total_cost if total_cost else 0
        
        conflict = get_conflict_type(sup_t, amz_t)
        if conflict or margin_ratio > 4.0:
            continue
            
        info = supplier_info.get(pid, {})
        moq = info.get("moq", 1)
        stok = info.get("stok", 0)
        
        stock_value = stok * contribution
        
        books.append({
            "pid": pid, "sup_title": sup_t, "ean": cat.get("primary_barcode"),
            "asin": asin, "stok": stok, "cost": cost, "amz_price": price,
            "fee": fee, "contribution": contribution, "moq": moq, 
            "stock_value": stock_value
        })

    # Sorts
    s_ge_5 = sorted([b for b in books if b["stok"] >= 5], key=lambda x: x["contribution"], reverse=True)
    s_ge_10 = sorted([b for b in books if b["stok"] >= 10], key=lambda x: x["contribution"], reverse=True)
    val_pot = sorted(books, key=lambda x: x["stock_value"], reverse=True)
    c_gt_150_s_ge_5 = [b for b in s_ge_5 if b["contribution"] > 150]
    c_gt_100_s_ge_10 = [b for b in s_ge_10 if b["contribution"] > 100]

    # Distributions
    dist = {"stok = 0": 0, "stok = 1": 0, "stok 2-5": 0, "stok 6-10": 0, "stok 11-25": 0, "stok 26-50": 0, "stok 50+": 0}
    for b in books:
        s = b["stok"]
        if s == 0: dist["stok = 0"] += 1
        elif s == 1: dist["stok = 1"] += 1
        elif 2 <= s <= 5: dist["stok 2-5"] += 1
        elif 6 <= s <= 10: dist["stok 6-10"] += 1
        elif 11 <= s <= 25: dist["stok 11-25"] += 1
        elif 26 <= s <= 50: dist["stok 26-50"] += 1
        else: dist["stok 50+"] += 1

    print("==================================================")
    print(f"968 BOOK AUTO OPPORTUNITY - STOCK DISTRIBUTION")
    print("==================================================")
    for k, v in dist.items():
        print(f"{k.ljust(15)}: {v}")

    def print_table(title, data, count=30, sort_by="contribution"):
        print(f"\n--- {title} ---")
        if not data:
            print("Sonuç bulunamadı.")
            return
        
        print("| Sıra | ID | Ürün Adı | EAN | ASIN | Stok | Maliyet | Amz Fiyatı | MFN Fee | Net Katkı | Toplam Potansiyel | MOQ |")
        print("|---|---|---|---|---|---|---|---|---|---|---|---|")
        for idx, b in enumerate(data[:count], 1):
            s_title = b['sup_title'].replace('|', '-')
            row = [
                str(idx), str(b["pid"]), s_title[:45], b["ean"], b["asin"], str(b["stok"]),
                f"{b['cost']:.2f} TL", f"{b['amz_price']:.2f} TL", f"{b['fee']:.2f} TL",
                f"{b['contribution']:.2f} TL", f"{b['stock_value']:.2f} TL", str(b["moq"])
            ]
            print("| " + " | ".join(row) + " |")

    print_table("STOK >= 5 OLAN EN İYİ 30 KİTAP (Katkıya Göre)", s_ge_5)
    print_table("STOK >= 10 OLAN EN İYİ 30 KİTAP (Katkıya Göre)", s_ge_10)
    print_table("STOCK VALUE POTENTIAL EN YÜKSEK 30 KİTAP", val_pot, sort_by="stock_value")
    print_table("KATKI > 150 TL VE STOK >= 5 OLAN ÜRÜNLER", c_gt_150_s_ge_5, count=100)
    print_table("KATKI > 100 TL VE STOK >= 10 OLAN ÜRÜNLER", c_gt_100_s_ge_10, count=100)

    # Summary
    stoks = [b["stok"] for b in books]
    print("\n--- ÖZET (968 FIRSAT) ---")
    print(f"Toplam Mevcut Stok Adedi  : {sum(stoks)}")
    print(f"Median Stok               : {statistics.median(stoks) if stoks else 0}")
    print(f"Stok >= 5 Ürün Sayısı     : {len(s_ge_5)}")
    print(f"Stok >= 10 Ürün Sayısı    : {len(s_ge_10)}")
    print(f"Stok >= 25 Ürün Sayısı    : {sum(1 for b in books if b['stok'] >= 25)}")

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    run()
