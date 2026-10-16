import csv
import sys

rows = []
with open('amazon_real_profit_pilot.csv', 'r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    for r in reader:
        if r['estimated_contribution_before_shipping']:
            rows.append(r)

rows.sort(key=lambda x: float(x['estimated_contribution_before_shipping']), reverse=True)

for i, r in enumerate(rows[:10]):
    print(f"{i+1}. {r['supplier_title']}")
    print(f"   Barkod: {r['barcode']} | ASIN: {r['asin']} | Pack: {r['pack_quantity_status']}")
    print(f"   Yıldırım Liste: {r['supplier_list_price']} TL | İskonto: {r['supplier_discount_rates']} | Net: {r['supplier_net_price_ex_vat']} TL | KDV: %{r['supplier_vat_rate']}")
    print(f"   Yıldırım Alış (KDV Dahil): {r['supplier_cost_inc_vat']} TL | Min Sipariş: {r['supplier_min_order_quantity']} | Nakit Gereksinimi: {r['minimum_purchase_cash_required']} TL")
    amazon_price = r['featured_offer_price'] or r['lowest_new_landed_price']
    print(f"   Amazon Fiyatı: {amazon_price} TL | Fee: {r['amazon_fee_estimate']} TL")
    print(f"   Katkı (Kargo Öncesi): {r['estimated_contribution_before_shipping']} TL | Marj: %{r['estimated_margin_before_shipping_pct']}")
    print('-'*50)
