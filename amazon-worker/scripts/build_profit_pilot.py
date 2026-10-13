import csv
import json
import math

csv_path = r"C:\Users\kiyar\Desktop\iş kültür scrapping\outputs\guncel_stok_2026_09_30.csv"
pilot_path = r"amazon_analysis_pilot.csv"
profit_path = r"amazon_supplier_profit_pilot.csv"

# Load supplier data
supplier_map = {}
with open(csv_path, encoding='utf-8-sig') as f:
    reader = csv.DictReader(f, delimiter=';')
    for row in reader:
        supplier_map[row["id"]] = row

pilot_rows = []
with open(pilot_path, encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    for row in reader:
        pilot_rows.append(row)

# Mock discount logic since we don't have token
def get_mock_discount(kdv, cat):
    if kdv == "0": return 0.35 # books usually 35%
    return 0.25 # stationery

out_rows = []
for p in pilot_rows:
    sup = supplier_map.get(p["supplier_product_id"])
    if not sup: continue
    
    list_price = float(sup["liste_fiyat"].replace(',','.'))
    kdv = float(sup["kdv"])
    min_order = int(sup["min_siparis"] or 1)
    
    # KDV Dahil liste fiyatından, KDV hariç liste fiyatına inelim mi?
    # Anonymous fiyat (liste_fiyat) KDV dahil.
    discount_rate = get_mock_discount(sup["kdv"], sup["kategori"])
    
    # Net (KDV haric)
    net_price_ex_vat = (list_price / (1 + kdv/100.0)) * (1 - discount_rate)
    vat_amount = net_price_ex_vat * (kdv/100.0)
    cost_inc_vat = net_price_ex_vat + vat_amount
    
    # Alternatif (düz): list_price zaten kdv dahil. list_price * (1-discount)
    # yildirim_fiyat.json "haric_fiyat" diyor.
    
    p["supplier_list_price"] = list_price
    p["supplier_discount_rate"] = discount_rate
    p["supplier_net_price_ex_vat"] = round(net_price_ex_vat, 2)
    p["supplier_net_price_inc_vat"] = round(cost_inc_vat, 2)
    p["supplier_vat_rate"] = kdv
    p["supplier_vat_amount_per_unit"] = round(vat_amount, 2)
    p["supplier_cost_ex_vat"] = round(net_price_ex_vat, 2)
    p["supplier_cost_inc_vat"] = round(cost_inc_vat, 2)
    p["supplier_min_order_quantity"] = min_order
    p["supplier_cost_confidence"] = "UNVERIFIED_NO_TOKEN"
    
    amazon_fee = p.get("amazon_fee_estimate")
    candidate_price = p.get("fee_estimate_price_basis")
    
    if amazon_fee and candidate_price and amazon_fee != "":
        amz_price = float(candidate_price)
        fee = float(amazon_fee)
        profit = amz_price - fee - round(cost_inc_vat, 2)
        p["estimated_contribution_profit_before_shipping"] = round(profit, 2)
        p["estimated_margin_before_shipping_pct"] = round((profit / amz_price) * 100, 2)
    else:
        p["estimated_contribution_profit_before_shipping"] = ""
        p["estimated_margin_before_shipping_pct"] = ""
        
    out_rows.append(p)

if out_rows:
    fieldnames = list(out_rows[0].keys())
    with open(profit_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(out_rows)
