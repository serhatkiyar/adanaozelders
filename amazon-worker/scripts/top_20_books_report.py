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
                lf_str = row.get("liste_fiyat", "0").replace(",", ".")
                try: lf = float(lf_str)
                except ValueError: lf = 0.0
                try: moq = int(row.get("min_siparis", 1) or 1)
                except ValueError: moq = 1
                supplier_info[pid] = {"liste_fiyat": lf, "moq": moq}

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
        lf = info.get("liste_fiyat", 0.0)
        moq = info.get("moq", 1)
        if lf <= 0: continue
            
        discount = ((lf - cost) / lf) * 100
        margin_pct = (contribution / float(price)) * 100
        amz_ratio = float(price) / lf
        cash_req = max(pack, moq) * cost
        
        books.append({
            "pid": pid, "sup_title": sup_t, "sup_ean": cat.get("primary_barcode"),
            "amz_ean": cat.get("selected_supplier_barcode"), "asin": asin, "amz_title": amz_t,
            "list_price": lf, "cost": cost, "discount": discount, "amz_price": price,
            "fee": fee, "contribution": contribution, "margin_pct": margin_pct,
            "amz_ratio": amz_ratio, "moq": moq, "cash_req": cash_req, "identity": "BOOK_EXACT_ISBN"
        })

    books.sort(key=lambda x: x["contribution"], reverse=True)
    top_20 = books[:20]

    print("| Sıra | Sup. ID | Yıldırım Ürün Adı | EAN Eşleşmesi (Sup == Amz) | ASIN | Amazon Ürün Başlığı | Liste Fiyatı | VERIFIED Maliyet | İskonto | Amazon Fiyatı | MFN Fee | Net Katkı | Marj | Amz/Liste Oranı | MOQ | Min Sermaye | Statü | Link |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for idx, b in enumerate(top_20, 1):
        ean_match = f"{b['sup_ean']} == {b['amz_ean']}"
        link = f"[Git](https://www.amazon.com.tr/dp/{b['asin']})"
        
        s_title = b['sup_title'].replace('|', '-')
        a_title = b['amz_title'].replace('|', '-')
        
        row = [
            str(idx), b["pid"], s_title, ean_match, b["asin"], a_title,
            f"{b['list_price']:.2f} TL", f"{b['cost']:.2f} TL", f"%{b['discount']:.1f}",
            f"{b['amz_price']:.2f} TL", f"{b['fee']:.2f} TL", f"{b['contribution']:.2f} TL",
            f"%{b['margin_pct']:.1f}", f"{b['amz_ratio']:.2f}x", str(b["moq"]),
            f"{b['cash_req']:.2f} TL", b["identity"], link
        ]
        print("| " + " | ".join(row) + " |")

    discounts = [b["discount"] for b in top_20]
    contribs = [b["contribution"] for b in top_20]
    margins = [b["margin_pct"] for b in top_20]
    amz_above_1_30 = sum(1 for b in top_20 if b["amz_ratio"] > 1.3)
    c_gt_200 = sum(1 for b in top_20 if b["contribution"] > 200)
    c_gt_500 = sum(1 for b in top_20 if b["contribution"] > 500)

    print("\n--- ÖZET (TOP 20 KİTAP) ---")
    print(f"Median Supplier Discount: %{statistics.median(discounts):.1f}")
    print(f"Median Contribution: {statistics.median(contribs):.2f} TL")
    print(f"Median Margin: %{statistics.median(margins):.1f}")
    print(f"Amazon fiyatı liste fiyatının %30 üzerinde olanlar: {amz_above_1_30}")
    print(f"Contribution > 200 TL: {c_gt_200}")
    print(f"Contribution > 500 TL: {c_gt_500}")

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    run()
