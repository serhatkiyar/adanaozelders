import csv
import sys
import os
import asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from core.suppliers.yildirim import YildirimClient

async def main():
    with open('temp_token.txt', 'r') as f:
        token = f.read().strip()
        
    csv_path = r"C:\Users\kiyar\Desktop\iş kültür scrapping\outputs\guncel_stok_2026_09_30.csv"
    
    products = []
    with open(csv_path, encoding='utf-8-sig') as f:
        reader = csv.DictReader(f, delimiter=';')
        for row in reader:
            products.append(row)
            
    # Select 10 diverse products
    # 3x KDV 0, 3x KDV 10, 4x KDV 20 (including some min_siparis > 1)
    kdv_0 = [p for p in products if p['kdv'] == '0']
    kdv_10 = [p for p in products if p['kdv'] == '10']
    kdv_20 = [p for p in products if p['kdv'] == '20']
    
    selected = kdv_0[:3] + kdv_10[:3] + kdv_20[:2]
    # find min_order > 1
    min_order_gt1 = [p for p in products if p['kdv'] == '20' and p['min_siparis'] and int(p['min_siparis']) > 1]
    selected += min_order_gt1[:2]
    
    # Just in case we didn't find min_order > 1, fill it up to 10
    while len(selected) < 10:
        selected.append(kdv_20[len(selected)])
        
    ids = [int(p['id']) for p in selected]
    print(f"Selected IDs: {ids}")
    
    # Create client
    client = YildirimClient(token=token, base_url="https://b2b.yildirimdagitim.com/api")
    
    # Fetch directly using internal _istek to get RAW payload to see exact fields
    try:
        raw_response = await client._istek("POST", "/fiyat", json={"stokIds": ids, "kirilim": True})
        
        fiyatlar = raw_response.get('fiyatlar', {})
        kirilim = raw_response.get('kirilim', {})
        
        results = []
        for p in selected:
            pid = p['id']
            f_data = fiyatlar.get(pid)
            k_data = kirilim.get(pid, [])
            
            if not f_data:
                results.append({"id": pid, "title": p['ad'], "error": "Not Found in /fiyat"})
                continue
                
            # Find PEŞİN
            pesin_k = next((k for k in k_data if k.get('altHesapId') == 2), None)
            
            results.append({
                "id": pid,
                "title": p['ad'],
                "barcode": p['barkod'],
                "list_price": f_data.get('taban'),
                "kdv_modu": f_data.get('kdvModu'),
                "kdv": f_data.get('kdv'),
                "pesin_net": pesin_k.get('net') if pesin_k else None,
                "iskontolar": pesin_k.get('iskontolar') if pesin_k else None,
                "min_siparis": p['min_siparis']
            })
            
        for r in results:
            print(f"--- {r['id']} : {r['title']} ---")
            if 'error' in r:
                print(f"Error: {r['error']}")
            else:
                print(f"List Price: {r['list_price']}")
                print(f"KDV Modu: {r['kdv_modu']}")
                print(f"KDV Oranı: {r['kdv']}")
                print(f"Peşin Net (Ex VAT): {r['pesin_net']}")
                print(f"Gerçek İskonto: {r['iskontolar']}")
                print(f"Min Sipariş: {r['min_siparis']}")
                
                net = float(r['pesin_net'])
                kdv = float(r['kdv'])
                vat_amount = net * (kdv/100)
                inc_vat = net + vat_amount
                print(f"Hesaplanan Gross (Inc VAT): {inc_vat:.2f}")
                print(f"Birim KDV Tutarı: {vat_amount:.2f}")
                
                # simulate checkout
                mo = int(r['min_siparis']) if r['min_siparis'] else 1
                cart_gross = round(net * (1 + kdv/100), 2)
                print(f"Sepet/Checkout (Yuvarlanmış) Birim: {cart_gross:.2f}")
                print(f"Sepet/Checkout Satır Toplamı ({mo} adet): {cart_gross * mo:.2f}")
                
    except Exception as e:
        print(f"API Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
