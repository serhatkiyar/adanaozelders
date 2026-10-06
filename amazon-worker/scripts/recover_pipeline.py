import json
import csv
import sys
import os
import time
import re
import requests
import traceback
import random

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from amazon_analyzer.client import call_sp_api
from amazon_analyzer.auth import MARKETPLACE_ID

CHK_CATALOG = "scan_checkpoint_catalog.json"
CHK_PRICING = "scan_checkpoint_pricing.json"
CHK_FEES_MFN = "scan_checkpoint_fees_mfn.json"
CHK_COST = "scan_checkpoint_cost.json"
SUPPLIER_CSV = r"C:\Users\kiyar\Desktop\iş kültür scrapping\outputs\guncel_stok_2026_09_30.csv"
if not os.path.exists(SUPPLIER_CSV):
    SUPPLIER_CSV = r"C:\Users\kiyar\Desktop\adana-ozel-ders\backend\scripts\guncel_stok_2026_09_30.csv"
    
HAR_PATH = r"C:\Users\kiyar\Desktop\b2b.yildirimdagitim.com_Archive [26-10-01 03-03-55].har"

def chunk_list(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]

def get_token_from_har():
    try:
        with open(HAR_PATH, "r", encoding="utf-8") as f:
            har_data = json.load(f)
        for entry in har_data.get("log", {}).get("entries", []):
            req = entry.get("request", {})
            for h in req.get("headers", []):
                if h.get("name", "").lower() == "authorization":
                    val = h.get("value", "")
                    if val.startswith("Bearer "):
                        return val
    except: pass
    return None

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
    catalog_chk = json.load(open(CHK_CATALOG, 'r', encoding='utf-8'))
    pricing_chk = json.load(open(CHK_PRICING, 'r', encoding='utf-8'))
    fees_mfn = json.load(open(CHK_FEES_MFN, 'r', encoding='utf-8'))
    cost_chk = json.load(open(CHK_COST, 'r', encoding='utf-8'))
    
    supplier_info = {}
    with open(SUPPLIER_CSV, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f, delimiter=";"):
            pid = str(row.get("id", "")).strip()
            if pid:
                lf_str = row.get("liste_fiyat", "0").replace(",", ".")
                try: lf = float(lf_str)
                except: lf = 0.0
                stok_str = row.get("stok", "0").replace(",", ".")
                try: st = int(float(stok_str))
                except: st = 0
                supplier_info[pid] = {"liste_fiyat": lf, "stok": st}
                
    # 1. Identify targets
    target_pids = []
    for pid, c in catalog_chk.items():
        if c.get("match_status") == "MATCHED":
            is_b = c.get("primary_barcode", "").startswith("978") or c.get("primary_barcode", "").startswith("979")
            asin = c.get("amazon_asin")
            if is_b and asin and asin not in pricing_chk:
                target_pids.append(pid)
                
    print(f"Targeting {len(target_pids)} recovered Books for Pricing/Fee/Cost layers...", flush=True)
    
    # 2. PRICING
    target_asins = list(set([catalog_chk[pid]["amazon_asin"] for pid in target_pids if catalog_chk[pid].get("amazon_asin")]))
    batches = list(chunk_list(target_asins, 20))
    print(f"Fetching Pricing for {len(target_asins)} ASINs ({len(batches)} batches)...", flush=True)
    
    pricing_stats = {"batches": 0, "attempts": 0, "429": 0, "success": 0, "incomplete": 0}
    
    for i, batch in enumerate(batches, 1):
        pricing_stats["batches"] += 1
        reqs = [{"uri": f"/products/pricing/v0/items/{a}/offers", "method": "GET", "MarketplaceId": MARKETPLACE_ID, "ItemCondition": "New"} for a in batch]
        
        success = False
        pricing_stats["attempts"] += 1
        try:
            res = call_sp_api("POST", "/batches/products/pricing/v0/itemOffers", data={"requests": reqs})
            for r in res.get("responses", []):
                status = r.get("status", {}).get("statusCode")
                body = r.get("body", {})
                asin = body.get("payload", {}).get("ASIN")
                if asin:
                    if status == 200:
                        summary = body.get("payload", {}).get("Summary", {})
                        lp = summary.get("LowestPrices", [])
                        bb = summary.get("BuyBoxPrices", [])
                        price = (bb[0].get("LandedPrice", {}).get("Amount") if bb else None) or (lp[0].get("LandedPrice", {}).get("Amount") if lp else None)
                        pricing_chk[asin] = {"amazon_price": price, "status": "SUCCESS" if price else "NO_OFFER"}
                        pricing_stats["success"] += 1
                    else:
                        pricing_chk[asin] = {"amazon_price": None, "status": "NO_OFFER" if status == 404 else "ERROR"}
            success = True
        except Exception as e:
            if "429" in str(e) or "Rate limit" in str(e): pricing_stats["429"] += 1
            
        if not success:
            for a in batch:
                pricing_chk[a] = {"amazon_price": None, "status": "PRICING_INCOMPLETE"}
                pricing_stats["incomplete"] += 1
                
        print(f"Pricing Batch {i}/{len(batches)} done.", flush=True)
        time.sleep(2.1)
        
    with open(CHK_PRICING, "w", encoding="utf-8") as f:
        json.dump(pricing_chk, f, indent=2, ensure_ascii=False)
        
    # 3. MFN FEES
    target_fees = [(a, pricing_chk[a]["amazon_price"]) for a in target_asins if a in pricing_chk and pricing_chk[a].get("amazon_price")]
    fee_batches = list(chunk_list(target_fees, 20))
    print(f"Fetching MFN Fees for {len(target_fees)} ASINs ({len(fee_batches)} batches)...", flush=True)
    
    for i, batch in enumerate(fee_batches, 1):
        payload = []
        for asin, price in batch:
            payload.append({
                "FeesEstimateRequest": {
                    "MarketplaceId": MARKETPLACE_ID,
                    "IsAmazonFulfilled": False,
                    "PriceToEstimateFees": {"ListingPrice": {"CurrencyCode": "TRY", "Amount": price}},
                    "Identifier": asin
                },
                "IdType": "ASIN", "IdValue": asin
            })
            
        success = False
        try:
            res = call_sp_api("POST", "/products/fees/v0/feesEstimate", data=payload)
            for item in res:
                asin = item.get("FeesEstimateIdentifier", {}).get("IdValue")
                status = item.get("Status")
                if status == "Success":
                    fee = item.get("FeesEstimate", {}).get("TotalFeesEstimate", {}).get("Amount")
                    fees_mfn[asin] = {"amazon_fee": fee, "status": "SUCCESS"}
                else:
                    error = item.get("Error", {}).get("Code")
                    fees_mfn[asin] = {"amazon_fee": None, "status": "ERROR", "reason": error}
            success = True
        except Exception as e:
            pass
            
        if not success:
            for a, _ in batch: fees_mfn[a] = {"amazon_fee": None, "status": "FEE_INCOMPLETE"}
            
        print(f"Fee Batch {i}/{len(fee_batches)} done.", flush=True)
        time.sleep(1.0)
            
    with open(CHK_FEES_MFN, "w", encoding="utf-8") as f:
        json.dump(fees_mfn, f, indent=2, ensure_ascii=False)
        
    # 4. YILDIRIM LIVE COST
    token = get_token_from_har()
    if token:
        cost_pids = [pid for pid in target_pids if pid not in cost_chk]
        cost_batches = list(chunk_list(cost_pids, 100))
        print(f"Fetching Live Cost for {len(cost_pids)} PIDs ({len(cost_batches)} batches)...", flush=True)
        
        headers = {"Authorization": token, "Content-Type": "application/json"}
        for i, batch in enumerate(cost_batches, 1):
            try:
                res = requests.post("https://b2b.yildirimdagitim.com/api/vitrin/fiyat", 
                                    json={"stokIds": [int(x) for x in batch], "altHesapId": 2}, 
                                    headers=headers, timeout=30)
                if res.status_code == 200:
                    for pid_str, item in res.json().get("fiyatlar", {}).items():
                        net = float(item.get("net", 0))
                        kdv = float(item.get("kdv", 0))
                        cost_chk[str(pid_str)] = {
                            "supplier_net_price_ex_vat": net,
                            "supplier_vat_rate": kdv,
                            "supplier_cost_inc_vat": net * (1 + kdv / 100),
                            "supplier_cost_confidence": "VERIFIED_LIVE"
                        }
            except Exception as e:
                pass
            print(f"Cost Batch {i}/{len(cost_batches)} done.", flush=True)
                
        with open(CHK_COST, "w", encoding="utf-8") as f:
            json.dump(cost_chk, f, indent=2, ensure_ascii=False)
    else:
        print("WARNING: Could not fetch HAR token. Costs might be incomplete.", flush=True)
        
    # 5. MERGE & CLASSIFY ALL 11,491 ITEMS
    print("Classifying and merging all 11,491 items...", flush=True)
    
    global_stats = {
        "AUTO_OPPORTUNITY": 0, "REVIEW_REQUIRED": 0, "REJECT": 0, 
        "FEE_INCOMPLETE": 0, "COST_INCOMPLETE": 0, "API_INCOMPLETE": 0
    }
    
    recovered_stats = {
        "active_offer": 0, "fee_success": 0, "cost_live": 0, "calculable": 0, "positive_contrib": 0,
        "AUTO_OPPORTUNITY": 0, "REVIEW_REQUIRED": 0, "REJECT": 0, 
        "FEE_INCOMPLETE": 0, "COST_INCOMPLETE": 0, "API_INCOMPLETE": 0
    }
    
    recovered_books = []
    
    for pid, c in catalog_chk.items():
        is_target = pid in target_pids
        
        match = c.get("match_status")
        if match != "MATCHED":
            if match == "CATALOG_INCOMPLETE": 
                global_stats["API_INCOMPLETE"] += 1
                if is_target: recovered_stats["API_INCOMPLETE"] += 1
            else:
                global_stats["REJECT"] += 1
                if is_target: recovered_stats["REJECT"] += 1
            continue
            
        asin = c.get("amazon_asin")
        price = pricing_chk.get(asin, {}).get("amazon_price")
        p_status = pricing_chk.get(asin, {}).get("status")
        
        if p_status == "PRICING_INCOMPLETE" or p_status == "API_INCOMPLETE":
            global_stats["API_INCOMPLETE"] += 1
            if is_target: recovered_stats["API_INCOMPLETE"] += 1
            continue
            
        if not price:
            global_stats["REJECT"] += 1
            if is_target: recovered_stats["REJECT"] += 1
            continue
            
        if is_target: recovered_stats["active_offer"] += 1
            
        fee_info = fees_mfn.get(asin, {})
        fee = fee_info.get("amazon_fee")
        f_status = fee_info.get("status")
        
        if f_status == "FEE_INCOMPLETE" or f_status == "API_INCOMPLETE" or (f_status == "ERROR" and not fee):
            global_stats["FEE_INCOMPLETE"] += 1
            if is_target: recovered_stats["FEE_INCOMPLETE"] += 1
            continue
            
        if is_target: recovered_stats["fee_success"] += 1
            
        cost_info = cost_chk.get(pid, {})
        cost = cost_info.get("supplier_cost_inc_vat")
        conf = cost_info.get("supplier_cost_confidence")
        
        if conf != "VERIFIED_LIVE" or not cost:
            global_stats["COST_INCOMPLETE"] += 1
            if is_target: recovered_stats["COST_INCOMPLETE"] += 1
            continue
            
        if is_target: recovered_stats["cost_live"] += 1
        
        pack = int(c.get("supplier_pack_quantity", 1))
        total_cost = cost * pack
        
        contribution = round(float(price) - float(fee) - total_cost, 2)
        
        if is_target: 
            recovered_stats["calculable"] += 1
            if contribution > 0: recovered_stats["positive_contrib"] += 1
            
        # Identity
        sup_t = c.get("supplier_title", "")
        amz_t = c.get("amazon_title", "")
        is_b = c.get("primary_barcode", "").startswith("978") or c.get("primary_barcode", "").startswith("979")
        identity = "UNKNOWN"
        
        conflict = get_conflict_type(sup_t, amz_t)
        margin_anomaly = (float(price) / total_cost) > 4.0 if total_cost else False
        
        if is_b and c.get("is_primary_barcode") == True and c.get("primary_barcode") == c.get("selected_supplier_barcode"):
            identity = "BOOK_EXACT_ISBN"
            if conflict: identity = "REVIEW_REQUIRED"
        elif is_b:
            identity = "REVIEW_REQUIRED"
        else:
            if c.get("pack_quantity_status") == "MATCH": identity = "EXACT_MATCH"
            elif c.get("pack_quantity_status") == "MISMATCH": identity = "REVIEW_REQUIRED"
            else: identity = "REVIEW_REQUIRED"
            
        is_review = conflict or margin_anomaly or identity in ["REVIEW_REQUIRED"]
        
        if contribution > 0 and not is_review and identity in ["BOOK_EXACT_ISBN", "EXACT_MATCH"]:
            global_stats["AUTO_OPPORTUNITY"] += 1
            if is_target:
                recovered_stats["AUTO_OPPORTUNITY"] += 1
                lf = supplier_info.get(pid, {}).get("liste_fiyat", 0)
                st = supplier_info.get(pid, {}).get("stok", 0)
                marg = (contribution / float(price)) * 100
                disc = ((lf - cost) / lf * 100) if lf else 0
                recovered_books.append({
                    "title": sup_t, "ean": c.get("primary_barcode"), "asin": asin, "amz_title": amz_t,
                    "stok": st, "cost": cost, "price": price, "fee": fee, "contrib": contribution,
                    "marg": marg, "lf": lf, "disc": disc, "identity": identity
                })
        elif contribution > 0:
            global_stats["REVIEW_REQUIRED"] += 1
            if is_target: recovered_stats["REVIEW_REQUIRED"] += 1
        else:
            global_stats["REJECT"] += 1
            if is_target: recovered_stats["REJECT"] += 1
            
    # REPORT
    print("\n" + "="*50)
    print("9. RECOVERED BOOK RAPORU")
    print("="*50)
    print(f"Pricing Http Attempts: {pricing_stats['attempts']}")
    print(f"Pricing 429s: {pricing_stats['429']}")
    print(f"Pricing Success: {pricing_stats['success']}")
    print(f"Pricing Incomplete: {pricing_stats['incomplete']}")
    print("-" * 30)
    print("Target Recovered Books : 1,248")
    print(f"  Active Offers        : {recovered_stats['active_offer']}")
    print(f"  MFN Fee Success      : {recovered_stats['fee_success']}")
    print(f"  VERIFIED_LIVE Cost   : {recovered_stats['cost_live']}")
    print(f"  Fully Calculable     : {recovered_stats['calculable']}")
    print(f"  Positive Contrib     : {recovered_stats['positive_contrib']}")
    print("-" * 30)
    print(f"  AUTO_OPPORTUNITY     : {recovered_stats['AUTO_OPPORTUNITY']}")
    print(f"  REVIEW_REQUIRED      : {recovered_stats['REVIEW_REQUIRED']}")
    print(f"  REJECT               : {recovered_stats['REJECT']}")
    print(f"  FEE_INCOMPLETE       : {recovered_stats['FEE_INCOMPLETE']}")
    print(f"  COST_INCOMPLETE      : {recovered_stats['COST_INCOMPLETE']}")
    print(f"  API_INCOMPLETE       : {recovered_stats['API_INCOMPLETE']}")
    
    total = sum(global_stats.values())
    print("\n" + "="*50)
    print("FINAL 11.491 FUNNEL")
    print("="*50)
    for k,v in global_stats.items(): print(f"{k.ljust(20)}: {v}")
    print(f"TOTAL               : {total}")
    
    print("\n" + "="*50)
    print("TOP 30 NEWLY RECOVERED AUTO OPPORTUNITIES")
    print("="*50)
    recovered_books.sort(key=lambda x: x["contrib"], reverse=True)
    print("| Ürün Adı | EAN | ASIN | Amazon Adı | Stok | Canlı Maliyet | Amz Fiyat | MFN Fee | Net Katkı | Marj | Liste Fiyatı | İskonto | Statü |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for b in recovered_books[:30]:
        t1 = b['title'][:20].replace('|','-')
        t2 = b['amz_title'][:20].replace('|','-')
        print(f"| {t1} | {b['ean']} | {b['asin']} | {t2} | {b['stok']} | {b['cost']:.2f} | {b['price']:.2f} | {b['fee']:.2f} | {b['contrib']:.2f} | %{b['marg']:.1f} | {b['lf']:.2f} | %{b['disc']:.1f} | {b['identity']} |")

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    run()
