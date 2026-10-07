import json
import csv
import sys
import os
import time
import requests

sys.path.append(os.path.abspath("backend"))
from amazon_analyzer.client import call_sp_api

CHK_CATALOG = "scan_checkpoint_catalog.json"
CHK_PRICING = "scan_checkpoint_pricing.json"
CHK_FEES = "scan_checkpoint_fees_mfn.json"
CHK_COST = "scan_checkpoint_cost.json"
MARKETPLACE_ID = "A33AVAJ2PDY3EV"
HAR_PATH = r"C:\Users\kiyar\Desktop\b2b.yildirimdagitim.com_Archive [26-10-01 03-03-55].har"

def chunk_list(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]

def get_token_from_har():
    with open(HAR_PATH, "r", encoding="utf-8") as f:
        har_data = json.load(f)
    for entry in har_data.get("log", {}).get("entries", []):
        req = entry.get("request", {})
        for h in req.get("headers", []):
            if h.get("name", "").lower() == "authorization":
                val = h.get("value", "")
                if val.startswith("Bearer "): return val
    return None

def fetch_pricing(asins_to_fetch, pricing_chk):
    success = 0
    incomp = 0
    no_offer = 0
    unique_asins = list(set(asins_to_fetch))
    
    print(f"\n[PRICING] Fetching prices for {len(unique_asins)} unique ASINs...")
    for chunk in chunk_list(unique_asins, 20):
        reqs = []
        for asin in chunk:
            reqs.append({
                "uri": f"/products/pricing/v0/items/{asin}/offers",
                "method": "GET",
                "MarketplaceId": MARKETPLACE_ID,
                "ItemCondition": "New"
            })
            
        success_chunk = False
        for attempt in range(6):
            try:
                res = call_sp_api("POST", "/batches/products/pricing/v0/itemOffers", data={"requests": reqs})
                for i, r in enumerate(res.get("responses", [])):
                    asin = chunk[i]
                    status_code = r.get("status", {}).get("statusCode")
                    
                    if status_code == 200:
                        offers = r.get("body", {}).get("payload", {}).get("Offers", [])
                        active_offers = [o for o in offers if o.get("SubCondition") == "new"]
                        if active_offers:
                            lowest = min(active_offers, key=lambda x: x.get("ListingPrice", {}).get("Amount", 99999))
                            pricing_chk[asin] = {
                                "amazon_price": lowest["ListingPrice"]["Amount"],
                                "status": "SUCCESS"
                            }
                            success += 1
                        else:
                            pricing_chk[asin] = {"status": "NO_OFFER"}
                            no_offer += 1
                    elif status_code in [400, 404]:
                        pricing_chk[asin] = {"status": "NO_OFFER"}
                        no_offer += 1
                    else:
                        pricing_chk[asin] = {"status": "PRICING_INCOMPLETE"}
                        incomp += 1
                success_chunk = True
                time.sleep(2.5)
                break
            except Exception as e:
                err_str = str(e).lower()
                if "rate limit" in err_str or "429" in err_str:
                    print(f"Rate limit, retrying chunk attempt {attempt+1}...")
                    time.sleep(4.0 * (2 ** attempt))
                else:
                    print(f"[PRICING] Batch hard failed: {e}")
                    break
                    
        if not success_chunk:
            print("[PRICING] Chunk completely failed due to retries.")
            for asin in chunk:
                pricing_chk[asin] = {"status": "PRICING_INCOMPLETE"}
                incomp += 1
                
    return success, no_offer, incomp

def fetch_fees(asins_to_fetch, fees_chk, pricing_chk):
    success = 0
    incomp = 0
    unique_asins = list(set(asins_to_fetch))
    
    print(f"\n[FEES] Fetching MFN fees for {len(unique_asins)} ASINs...")
    for asin in unique_asins:
        price = pricing_chk.get(asin, {}).get("amazon_price")
        if not price:
            fees_chk[asin] = {"status": "FEE_INCOMPLETE"}
            incomp += 1
            continue
            
        success_chunk = False
        for attempt in range(5):
            try:
                req = {
                    "FeesEstimateRequest": {
                        "MarketplaceId": MARKETPLACE_ID,
                        "IsAmazonFulfilled": False,
                        "PriceToEstimateFees": {
                            "ListingPrice": {"CurrencyCode": "TRY", "Amount": price}
                        },
                        "Identifier": asin
                    }
                }
                res = call_sp_api("POST", f"/products/fees/v0/items/{asin}/feesEstimate", data=req)
                est = res.get("payload", {}).get("FeesEstimate", {})
                total_fee = est.get("TotalFeesEstimate", {}).get("Amount")
                
                if total_fee is not None:
                    fees_chk[asin] = {"amazon_fee": total_fee, "status": "SUCCESS"}
                    success += 1
                else:
                    fees_chk[asin] = {"status": "FEE_INCOMPLETE"}
                    incomp += 1
                success_chunk = True
                time.sleep(0.15)
                break
            except Exception as e:
                err_str = str(e).lower()
                if "rate limit" in err_str or "429" in err_str:
                    time.sleep(1.0 * (2 ** attempt))
                else:
                    break
                    
        if not success_chunk:
            fees_chk[asin] = {"status": "FEE_INCOMPLETE"}
            incomp += 1
            
    return success, incomp

def fetch_costs(pids_to_fetch, cost_chk, token):
    success = 0
    incomp = 0
    print(f"\n[COSTS] Fetching Live Costs for {len(pids_to_fetch)} PIDs...")
    headers = {"Authorization": token, "Content-Type": "application/json"}
    
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
                    success += 1
            else:
                for x in batch: incomp += 1
        except Exception as e:
            for x in batch: incomp += 1
            
    # Mark unfetched as incomplete
    for pid in pids_to_fetch:
        if str(pid) not in cost_chk:
            cost_chk[str(pid)] = {"supplier_cost_confidence": "INCOMPLETE"}
            
    return success, incomp

def run():
    catalog = json.load(open(CHK_CATALOG, "r", encoding="utf-8"))
    
    # 1. Read audit data and apply to Catalog
    audit_map = {}
    with open("recovered_nonbook_audit.csv", "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            audit_map[row["supplier_product_id"]] = row.get("semantic_confidence", "")
            
    eligible_pids = []
    
    for pid, conf in audit_map.items():
        if pid in catalog:
            catalog[pid]["semantic_confidence"] = conf
            if conf == "CONFLICT":
                catalog[pid]["match_status"] = "CATALOG_IDENTITY_CONFLICT"
            elif conf == "REVIEW":
                catalog[pid]["match_status"] = "CATALOG_IDENTITY_REVIEW"
            elif conf in ["HIGH", "MEDIUM"]:
                # Leave as MATCHED
                eligible_pids.append(pid)
                
    # 2. Global Metrics
    stats = {
        "RAW_MATCHED": 0,
        "TRUSTED_MATCHED": 0,
        "IDENTITY_REVIEW": 0,
        "IDENTITY_CONFLICT": 0,
        "CATALOG_INCOMPLETE": 0,
        "NOT_FOUND": 0
    }
    
    for c in catalog.values():
        st = c.get("match_status", "")
        if st == "MATCHED":
            stats["RAW_MATCHED"] += 1
            stats["TRUSTED_MATCHED"] += 1
        elif st == "CATALOG_IDENTITY_REVIEW":
            stats["RAW_MATCHED"] += 1
            stats["IDENTITY_REVIEW"] += 1
        elif st == "CATALOG_IDENTITY_CONFLICT":
            stats["RAW_MATCHED"] += 1
            stats["IDENTITY_CONFLICT"] += 1
        elif st == "CATALOG_INCOMPLETE":
            stats["CATALOG_INCOMPLETE"] += 1
        elif st == "NOT_FOUND":
            stats["NOT_FOUND"] += 1
            
    print("\n==================================================")
    print("GLOBAL CATALOG METRICS")
    print("==================================================")
    print(f"RAW_MATCHED              : {stats['RAW_MATCHED']}")
    print(f"  TRUSTED_MATCHED        : {stats['TRUSTED_MATCHED']}")
    print(f"  IDENTITY_REVIEW        : {stats['IDENTITY_REVIEW']}")
    print(f"  IDENTITY_CONFLICT      : {stats['IDENTITY_CONFLICT']}")
    print(f"CATALOG_INCOMPLETE       : {stats['CATALOG_INCOMPLETE']}")
    print(f"NOT_FOUND                : {stats['NOT_FOUND']}")
    
    total = stats["RAW_MATCHED"] + stats["CATALOG_INCOMPLETE"] + stats["NOT_FOUND"]
    print(f"\nTOTAL PRODUCTS           : {total} (Expected: 11491)")
    
    with open(CHK_CATALOG, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
        
    # 3. Pipeline for Eligible 973
    pricing_chk = json.load(open(CHK_PRICING, "r", encoding="utf-8")) if os.path.exists(CHK_PRICING) else {}
    fees_chk = json.load(open(CHK_FEES, "r", encoding="utf-8")) if os.path.exists(CHK_FEES) else {}
    cost_chk = json.load(open(CHK_COST, "r", encoding="utf-8")) if os.path.exists(CHK_COST) else {}
    
    target_asins = []
    for pid in eligible_pids:
        asin = catalog[pid].get("amazon_asin")
        if asin:
            target_asins.append(asin)
            
    p_suc, p_no, p_inc = fetch_pricing(target_asins, pricing_chk)
    
    asins_for_fees = [asin for asin in target_asins if pricing_chk.get(asin, {}).get("amazon_price") is not None]
    f_suc, f_inc = fetch_fees(asins_for_fees, fees_chk, pricing_chk)
    
    token = get_token_from_har()
    if token:
        c_suc, c_inc = fetch_costs(eligible_pids, cost_chk, token)
    else:
        print("FAILED TO GET HAR TOKEN, SKIPPING COSTS")
        c_suc, c_inc = 0, len(eligible_pids)
        
    with open(CHK_PRICING, "w", encoding="utf-8") as f: json.dump(pricing_chk, f, indent=2, ensure_ascii=False)
    with open(CHK_FEES, "w", encoding="utf-8") as f: json.dump(fees_chk, f, indent=2, ensure_ascii=False)
    with open(CHK_COST, "w", encoding="utf-8") as f: json.dump(cost_chk, f, indent=2, ensure_ascii=False)
    
    # 4. Generate Final Funnel for the 973
    f_stats = {
        "active_offer": 0, "no_offer": 0, "fee_success": 0, "fee_incomplete": 0,
        "verified_cost": 0, "positive_contribution": 0,
        "AUTO": 0, "REVIEW": 0, "REJECT": 0
    }
    
    for pid in eligible_pids:
        c = catalog[pid]
        asin = c.get("amazon_asin")
        price = pricing_chk.get(asin, {}).get("amazon_price")
        p_status = pricing_chk.get(asin, {}).get("status")
        fee = fees_chk.get(asin, {}).get("amazon_fee")
        cost_info = cost_chk.get(str(pid), {})
        cost = cost_info.get("supplier_cost_inc_vat")
        conf = cost_info.get("supplier_cost_confidence")
        
        if price is not None: f_stats["active_offer"] += 1
        elif p_status == "NO_OFFER": f_stats["no_offer"] += 1
        
        if fee is not None: f_stats["fee_success"] += 1
        else: f_stats["fee_incomplete"] += 1
        
        if conf == "VERIFIED_LIVE" and cost is not None: f_stats["verified_cost"] += 1
        
        contrib = -99999
        if price is not None and fee is not None and conf == "VERIFIED_LIVE" and cost is not None:
            pack = int(c.get("supplier_pack_quantity", 1))
            total_cost = cost * pack
            contrib = float(price) - float(fee) - total_cost
            if contrib > 0:
                f_stats["positive_contribution"] += 1
                
        if not price or p_status == "NO_OFFER":
            f_stats["REJECT"] += 1
        elif contrib > 0:
            if c.get("semantic_confidence") == "HIGH":
                f_stats["AUTO"] += 1
            else:
                f_stats["REVIEW"] += 1
        elif contrib <= 0 and contrib != -99999:
            f_stats["REJECT"] += 1
        else:
            f_stats["REVIEW"] += 1
            
    print("\n==================================================")
    print(f"973 ELIGIBLE NON-BOOK COHORT RESULTS")
    print("==================================================")
    print(f"Active Offer               : {f_stats['active_offer']}")
    print(f"No Offer                   : {f_stats['no_offer']}")
    print(f"Fee Success                : {f_stats['fee_success']}")
    print(f"Fee Incomplete             : {f_stats['fee_incomplete']}")
    print(f"Verified Cost              : {f_stats['verified_cost']}")
    print(f"Positive Contribution      : {f_stats['positive_contribution']}")
    print("\nFINAL CATEGORIZATION:")
    print(f"AUTO                       : {f_stats['AUTO']}")
    print(f"REVIEW                     : {f_stats['REVIEW']}")
    print(f"REJECT                     : {f_stats['REJECT']}")

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    run()
