import json
import os
import requests
import sys

HAR_PATH = r"C:\Users\kiyar\Desktop\b2b.yildirimdagitim.com_Archive [26-10-01 03-03-55].har"
CHK_CATALOG = "scan_checkpoint_catalog.json"
CHK_PRICING = "scan_checkpoint_pricing.json"
CHK_FEES_MFN = "scan_checkpoint_fees_mfn.json"
CHK_COST = "scan_checkpoint_cost.json"

def get_token_from_har():
    with open(HAR_PATH, "r", encoding="utf-8") as f:
        har_data = json.load(f)
    for entry in har_data.get("log", {}).get("entries", []):
        req = entry.get("request", {})
        for h in req.get("headers", []):
            if h.get("name", "").lower() == "authorization":
                val = h.get("value", "")
                if val.startswith("Bearer "):
                    return val
    return None

def chunk_list(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]

def run():
    token = get_token_from_har()
    if not token:
        print("ERROR: Could not extract Bearer token from HAR.")
        sys.exit(1)
        
    catalog_chk = json.load(open(CHK_CATALOG, 'r', encoding='utf-8'))
    pricing_chk = json.load(open(CHK_PRICING, 'r', encoding='utf-8'))
    fees_mfn = json.load(open(CHK_FEES_MFN, 'r', encoding='utf-8'))
    cost_chk = json.load(open(CHK_COST, 'r', encoding='utf-8')) if os.path.exists(CHK_COST) else {}
    
    # Identify books that need cost
    pids_to_fetch = []
    
    for pid, c in catalog_chk.items():
        is_book = c.get("primary_barcode", "").startswith("978") or c.get("primary_barcode", "").startswith("979")
        if not is_book:
            continue
            
        asin = c.get("amazon_asin")
        if not asin:
            continue
            
        price = pricing_chk.get(asin, {}).get("amazon_price")
        fee = fees_mfn.get(asin, {}).get("amazon_fee")
        
        # We only need live cost if there's an offer and fee, to calculate profitability
        if price and fee and pid not in cost_chk:
            pids_to_fetch.append(pid)
            
    print(f"Found {len(pids_to_fetch)} books needing live cost.")
    
    if not pids_to_fetch:
        print("Nothing to do.")
        return
        
    # Fetch in batches of 100
    headers = {
        "Authorization": token,
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json"
    }
    
    success_count = 0
    for batch in chunk_list(pids_to_fetch, 100):
        try:
            res = requests.post(
                "https://b2b.yildirimdagitim.com/api/vitrin/fiyat",
                json={"stokIds": [int(x) for x in batch], "altHesapId": 2},
                headers=headers,
                timeout=30
            )
            if res.status_code == 200:
                data = res.json()
                for pid_str, item in data.get("fiyatlar", {}).items():
                    net_price = float(item.get("net", 0))
                    vat_rate = float(item.get("kdv", 0))
                    cost_inc_vat = net_price * (1 + vat_rate / 100)
                    
                    cost_chk[str(pid_str)] = {
                        "supplier_net_price_ex_vat": net_price,
                        "supplier_vat_rate": vat_rate,
                        "supplier_cost_inc_vat": cost_inc_vat,
                        "supplier_cost_confidence": "VERIFIED_LIVE"
                    }
                    success_count += 1
            else:
                print(f"Batch failed with {res.status_code}: {res.text}")
        except Exception as e:
            print(f"Batch exception: {e}")
            
    print(f"Successfully fetched live cost for {success_count} books.")
    
    with open(CHK_COST, "w", encoding="utf-8") as f:
        json.dump(cost_chk, f, indent=2, ensure_ascii=False)

if __name__ == "__main__":
    run()
