import json
import csv
import sys
import os
import statistics

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

CHK_COST = "scan_checkpoint_cost.json"
SUPPLIER_CSV = r"C:\Users\kiyar\Desktop\iş kültür scrapping\outputs\guncel_stok_2026_09_30.csv"
AUTO_CSV = "commercial_auto_opportunities.csv"

def run():
    # 1. Load Supplier Data
    supplier_data = {}
    with open(SUPPLIER_CSV, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f, delimiter=";"):
            pid = str(row.get("id", "")).strip()
            if pid:
                lf_str = row.get("liste_fiyat", "0").replace(",", ".")
                try:
                    lf = float(lf_str)
                except ValueError:
                    lf = 0.0
                supplier_data[pid] = {
                    "liste_fiyat": lf,
                    "marka": row.get("marka", "Bilinmeyen"),
                    "barkod": row.get("barkod", "")
                }
                
    # 2. Load Cost Checkpoint and calculate discounts
    cost_chk = {}
    if os.path.exists(CHK_COST):
        cost_chk = json.load(open(CHK_COST, 'r', encoding='utf-8'))
        
    verified_items = []
    book_discounts = []
    nonbook_discounts = []
    brand_stats = {}
    
    for pid, cinfo in cost_chk.items():
        if cinfo.get("supplier_cost_confidence") == "VERIFIED_LIVE":
            sup = supplier_data.get(pid)
            if not sup: continue
            
            lf = sup["liste_fiyat"]
            if lf <= 0: continue
            
            cost = cinfo.get("supplier_cost_inc_vat")
            if not cost: continue
            
            discount = ((lf - cost) / lf) * 100
            # Cap anomalies (e.g. cost > list price means negative discount)
            
            barcode = sup["barkod"]
            is_book = barcode.startswith("978") or barcode.startswith("979")
            brand = sup["marka"]
            
            item = {
                "pid": pid,
                "discount": discount,
                "is_book": is_book,
                "brand": brand,
                "liste_fiyat": lf,
                "cost": cost
            }
            verified_items.append(item)
            
            if is_book: book_discounts.append(discount)
            else: nonbook_discounts.append(discount)
                
            if brand not in brand_stats:
                brand_stats[brand] = []
            brand_stats[brand].append(discount)
            
    # 3. Calculate Distributions
    def print_stats(name, arr):
        if not arr: return
        arr = sorted(arr)
        count = len(arr)
        avg = sum(arr) / count
        median = statistics.median(arr)
        p25 = arr[int(count * 0.25)]
        p75 = arr[int(count * 0.75)]
        p90 = arr[int(count * 0.90)]
        print(f"{name} ({count} products):")
        print(f"  Average : %{avg:.1f}")
        print(f"  P25     : %{p25:.1f}")
        print(f"  Median  : %{median:.1f}")
        print(f"  P75     : %{p75:.1f}")
        print(f"  P90     : %{p90:.1f}")
        
    def get_bucket(d):
        if d < 5: return "< %5"
        elif d < 10: return "%5-10"
        elif d < 15: return "%10-15"
        elif d < 20: return "%15-20"
        elif d < 25: return "%20-25"
        elif d < 30: return "%25-30"
        elif d < 35: return "%30-35"
        elif d < 40: return "%35-40"
        else: return "%40+"

    buckets = {k: 0 for k in ["< %5", "%5-10", "%10-15", "%15-20", "%20-25", "%25-30", "%30-35", "%35-40", "%40+"]}
    for item in verified_items:
        buckets[get_bucket(item["discount"])] += 1
        
    print("==================================================")
    print("YILDIRIM DAĞITIM B2B DEALER DISCOUNT AUDIT")
    print("==================================================")
    print(f"Total VERIFIED_LIVE evaluated: {len(verified_items)}")
    
    print("\n--- OVERALL DISTRIBUTION ---")
    for k, v in buckets.items():
        print(f"  {k.ljust(10)}: {v}")
        
    print("\n--- STATISTICAL QUARTILES ---")
    all_discounts = [x["discount"] for x in verified_items]
    print_stats("ALL PRODUCTS", all_discounts)
    print("")
    print_stats("BOOKS (978/979)", book_discounts)
    print("")
    print_stats("NON-BOOKS", nonbook_discounts)
    
    print("\n--- BRAND PERFORMANCE (Min 30 Products) ---")
    valid_brands = [(b, arr) for b, arr in brand_stats.items() if len(arr) >= 30]
    valid_brands.sort(key=lambda x: statistics.median(x[1]), reverse=True)
    for b, arr in valid_brands:
        med = statistics.median(arr)
        avg = sum(arr)/len(arr)
        print(f"{b.ljust(30)} | Count: {str(len(arr)).ljust(4)} | Median: %{med:.1f} | Avg: %{avg:.1f}")
        
    gt_30 = sum(1 for d in all_discounts if d >= 30)
    gt_40 = sum(1 for d in all_discounts if d >= 40)
    print(f"\nProducts with >= %30 discount: {gt_30}")
    print(f"Products with >= %40 discount: {gt_40}")

    # 4. Evaluate AUTO_OPPORTUNITIES
    print("\n==================================================")
    print("AUTO OPPORTUNITY SOURCE ANALYSIS")
    print("==================================================")
    
    group_a = 0
    group_b = 0
    group_c = 0
    
    if os.path.exists(AUTO_CSV):
        with open(AUTO_CSV, "r", encoding="utf-8-sig") as f:
            reader = list(csv.DictReader(f))
            for row in reader:
                barcode = row.get("primary_barcode", "")
                amz_price = float(row.get("amazon_price", 0))
                cost = float(row.get("supplier_cost_inc_vat", 0))
                
                # Find liste_fiyat from supplier_data using barcode
                # (Since we might not have pid, searching by barcode is safest for the CSV)
                lf = 0.0
                for p, s in supplier_data.items():
                    if s["barkod"] == barcode:
                        lf = s["liste_fiyat"]
                        break
                        
                if lf <= 0: continue
                
                discount = ((lf - cost) / lf) * 100
                amz_ratio = amz_price / lf
                
                # Thresholds: Strong discount >= 25%, Amazon Anomaly Ratio > 1.3
                strong_discount = discount >= 25.0
                amazon_anomaly = amz_ratio > 1.3
                
                if strong_discount and not amazon_anomaly:
                    group_a += 1
                elif not strong_discount and amazon_anomaly:
                    group_b += 1
                elif not strong_discount and not amazon_anomaly:
                    group_c += 1
                else:
                    # Strong discount AND amazon anomaly
                    # Let's count them towards A (True wholesale) since they have a strong discount,
                    # or B if we want to be strict. The prompt implies classifying mainly by discount & ratio.
                    # Prompt: "Yıldırım indirimi güçlü ve Amazon fiyatı normal" -> A
                    group_a += 1
                    
        total_auto = group_a + group_b + group_c
        print(f"Total AUTO_OPPORTUNITIES mapped: {total_auto}")
        print(f"A) Gerçek Toptan Fırsat (Güçlü İndirim) : {group_a} (%{group_a/total_auto*100 if total_auto else 0:.1f})")
        print(f"B) Amazon Fiyat Anomalisi (Zayıf İndirim): {group_b} (%{group_b/total_auto*100 if total_auto else 0:.1f})")
        print(f"C) Zayıf Fırsat (Zayıf İndirim + Normal) : {group_c} (%{group_c/total_auto*100 if total_auto else 0:.1f})")

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    run()
