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

def is_exam_book(title):
    t = title.upper()
    # Regex to catch typical Turkish exam/textbook keywords
    exam_kw = r'\b(\d\.?\s*SINIF|TYT|AYT|YKS|LGS|KPSS|ALES|DGS|YDS|YÖKDİL|İOKBS|MSÜ|SORU BANKASI|DENEME|KONU ANLATIMI?L?I?|YAPRAK TEST|BURSLULUK|SINAV|FASİKÜL|ÇÖZÜMLÜ|ÇIKMIŞ SORULAR|MÜFREDAT|TEST|BİLSEM|TÜM DERSLER|DERS KİTABI)\b'
    if re.search(exam_kw, t):
        return True
    return False

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
    exam_book_count = 0

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
            
        # Filter Exam Books
        if is_exam_book(sup_t) or is_exam_book(amz_t):
            exam_book_count += 1
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
    val_pot = sorted(books, key=lambda x: x["stock_value"], reverse=True)
    c_gt_100_s_ge_5 = [b for b in s_ge_5 if b["contribution"] > 100]

    # Print New Results
    print(f"Elenen Sınav/Test Kitabı Sayısı: {exam_book_count}")
    print(f"Kalan Kültür/Edebiyat/Genel Kitap Fırsatı: {len(books)}")
    print("="*50)
    
    def print_table(title, data, count=15, sort_by="contribution"):
        print(f"\n--- {title} ---")
        if not data:
            print("Sonuç bulunamadı.")
            return
        for idx, b in enumerate(data[:count], 1):
            s_title = b['sup_title'][:45]
            if sort_by == "stock_value":
                print(f"{idx}. {s_title} | Stok: {b['stok']} | Net Kâr: {b['contribution']:.2f} TL | **Toplam Potansiyel: {b['stock_value']:.2f} TL**")
            else:
                print(f"{idx}. {s_title} | Stok: {b['stok']} | **Net Kâr: {b['contribution']:.2f} TL** | Toplam Potansiyel: {b['stock_value']:.2f} TL")

    print_table("💎 STOK X KÂR = EN BÜYÜK POTANSİYEL TOP 10 (Sınav Kitapları Hariç)", val_pot, count=10, sort_by="stock_value")
    print_table("🔥 YÜKSEK KÂR (100+ TL) VE STOK (>= 5 ADET) TOP 15 (Sınav Kitapları Hariç)", c_gt_100_s_ge_5, count=15, sort_by="contribution")
    
if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    run()
