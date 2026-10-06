import json
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

def run():
    catalog = json.load(open(CHK_CATALOG, "r", encoding="utf-8"))
    pricing_chk = json.load(open(CHK_PRICING, "r", encoding="utf-8")) if os.path.exists(CHK_PRICING) else {}
    fees_chk = json.load(open(CHK_FEES, "r", encoding="utf-8")) if os.path.exists(CHK_FEES) else {}
    cost_chk = json.load(open(CHK_COST, "r", encoding="utf-8")) if os.path.exists(CHK_COST) else {}

    # Get the 27 newly trusted
    # To identify them safely, we can just fetch all NONBOOK MATCHED PIDs that are in the summary
    import csv
    new_pids = []
    with open("nonbook_notfound_verification_summary.csv", "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row["classification"] == "RECOVERED" and row["supplier_product_id"] != "99379":
                new_pids.append(row["supplier_product_id"])

    asins_to_price = []
    asin_to_pid = {}
    for pid in new_pids:
        asin = catalog[pid].get("amazon_asin")
        if asin and asin not in asins_to_price:
            asins_to_price.append(asin)
            asin_to_pid[asin] = pid

    print(f"Starting pipeline for {len(new_pids)} PIDs ({len(asins_to_price)} unique ASINs)...")

    # PRICING
    print(f"[PRICING] Fetching prices...")
    def chunk_list(lst, n):
        for i in range(0, len(lst), n):
            yield lst[i:i + n]

    for chunk in chunk_list(asins_to_price, 20):
        reqs = [{
            "uri": f"/products/pricing/v0/items/{a}/offers",
            "method": "GET",
            "MarketplaceId": MARKETPLACE_ID,
            "ItemCondition": "New"
        } for a in chunk]
        
        for attempt in range(5):
            try:
                res = call_sp_api("POST", "/batches/products/pricing/v0/itemOffers", data={"requests": reqs})
                for i, r in enumerate(res.get("responses", [])):
                    asin = chunk[i]
                    status_code = r.get("status", {}).get("statusCode")
                    
                    if status_code == 200:
                        offers = r.get("body", {}).get("payload", {}).get("Offers", [])
                        if offers:
                            lowest = min(o.get("ListingPrice", {}).get("Amount", 999999) for o in offers)
                            pricing_chk[asin] = {"amazon_price": lowest, "status": "SUCCESS"}
                        else:
                            pricing_chk[asin] = {"status": "NO_OFFER"}
                    elif status_code == 400:
                        pricing_chk[asin] = {"status": "NO_OFFER"}
                    else:
                        pricing_chk[asin] = {"status": "PRICING_INCOMPLETE"}
                break
            except Exception as e:
                err_str = str(e).lower()
                if "rate limit" in err_str or "429" in err_str:
                    time.sleep(4.0 * (2 ** attempt))
                else:
                    for asin in chunk:
                        pricing_chk[asin] = {"status": "PRICING_INCOMPLETE"}
                    break
                    
    with open(CHK_PRICING, "w", encoding="utf-8") as f:
        json.dump(pricing_chk, f, indent=2, ensure_ascii=False)

    # FEES
    print("[FEES] Fetching MFN fees...")
    for asin in asins_to_price:
        price = pricing_chk.get(asin, {}).get("amazon_price")
        if not price:
            continue
            
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
        
        for attempt in range(6):
            try:
                res = call_sp_api("POST", f"/products/fees/v0/items/{asin}/feesEstimate", data=req)
                est = res.get("payload", {}).get("FeesEstimateResult", {}).get("FeesEstimate", {})
                total_fee = est.get("TotalFeesEstimate", {}).get("Amount")
                
                if total_fee is not None:
                    fees_chk[asin] = {"amazon_fee": total_fee, "status": "SUCCESS"}
                else:
                    fees_chk[asin] = {"status": "FEE_INCOMPLETE"}
                break
            except Exception as e:
                err_str = str(e).lower()
                if "internal error" in err_str or "500" in err_str or "servererror" in err_str:
                    time.sleep(2.0 * (2 ** attempt))
                elif "rate limit" in err_str or "429" in err_str:
                    time.sleep(1.0 * (2 ** attempt))
                else:
                    fees_chk[asin] = {"status": "FEE_INCOMPLETE"}
                    break
        else:
            fees_chk[asin] = {"status": "FEE_INCOMPLETE"}
            
        time.sleep(0.25)
        
    with open(CHK_FEES, "w", encoding="utf-8") as f:
        json.dump(fees_chk, f, indent=2, ensure_ascii=False)

    # COSTS
    print("[COSTS] Fetching live costs...")
    for pid in new_pids:
        c = catalog[pid]
        pri = c.get("primary_barcode")
        if not pri:
            continue
        try:
            r = requests.post("https://b2b.yildirimkirtasiye.com.tr/api/vitrin/fiyat", 
                              json={"barkod": pri, "altHesapId": 2}, timeout=10)
            if r.status_code == 200:
                data = r.json()
                if data.get("statu"):
                    stok = data.get("stok", {})
                    if stok.get("pesin"):
                        net_ex = stok["pesin"]
                        vat_rate = stok.get("kdvOrani", 0)
                        inc_vat = net_ex * (1 + (vat_rate / 100.0))
                        cost_chk[str(pid)] = {
                            "supplier_cost_ex_vat": net_ex,
                            "supplier_vat_rate": vat_rate,
                            "supplier_cost_inc_vat": inc_vat,
                            "supplier_cost_confidence": "VERIFIED_LIVE"
                        }
        except Exception:
            pass
            
    with open(CHK_COST, "w", encoding="utf-8") as f:
        json.dump(cost_chk, f, indent=2, ensure_ascii=False)

    # FUNNEL
    f_stats = {
        "active_offer": 0, "no_offer": 0, "fee_success": 0, "fee_incomplete": 0,
        "verified_cost": 0, "positive_contribution": 0,
        "AUTO": 0, "REVIEW": 0, "REJECT": 0, "FEE_INCOMPLETE": 0
    }

    for pid in new_pids:
        c = catalog[pid]
        asin = c.get("amazon_asin")
        price = pricing_chk.get(asin, {}).get("amazon_price")
        p_status = pricing_chk.get(asin, {}).get("status")
        fee = fees_chk.get(asin, {}).get("amazon_fee")
        cost_info = cost_chk.get(str(pid), {})
        cost = cost_info.get("supplier_cost_inc_vat")
        conf = cost_info.get("supplier_cost_confidence")

        if price is not None:
            f_stats["active_offer"] += 1
        elif p_status == "NO_OFFER":
            f_stats["no_offer"] += 1

        if fee is not None:
            f_stats["fee_success"] += 1
        else:
            f_stats["fee_incomplete"] += 1

        if conf == "VERIFIED_LIVE" and cost is not None:
            f_stats["verified_cost"] += 1

        contrib = None
        if price is not None and fee is not None and conf == "VERIFIED_LIVE" and cost is not None:
            pack = int(c.get("supplier_pack_quantity", 1))
            total_cost = cost * pack
            contrib = float(price) - float(fee) - total_cost
            if contrib > 0:
                f_stats["positive_contribution"] += 1

        # Final status
        if not price or p_status == "NO_OFFER":
            f_stats["REJECT"] += 1
        elif fee is None:
            f_stats["FEE_INCOMPLETE"] += 1
        elif contrib is not None and contrib > 0:
            if c.get("semantic_confidence") == "HIGH":
                f_stats["AUTO"] += 1
            else:
                f_stats["REVIEW"] += 1
        else:
            f_stats["REJECT"] += 1

    print("\n==================================================")
    print(f"27 NEWLY TRUSTED COHORT FUNNEL")
    print("==================================================")
    print(f"ACTIVE_OFFER             : {f_stats['active_offer']}")
    print(f"NO_OFFER                 : {f_stats['no_offer']}")
    print(f"MFN_FEE_SUCCESS          : {f_stats['fee_success']}")
    print(f"FEE_INCOMPLETE           : {f_stats['fee_incomplete']}")
    print(f"VERIFIED_LIVE_COST       : {f_stats['verified_cost']}")
    print(f"POSITIVE_CONTRIBUTION    : {f_stats['positive_contribution']}")
    print("")
    print("FINAL STATUS:")
    print(f"AUTO                     : {f_stats['AUTO']}")
    print(f"REVIEW                   : {f_stats['REVIEW']}")
    print(f"REJECT                   : {f_stats['REJECT']}")
    print(f"FEE_INCOMPLETE           : {f_stats['FEE_INCOMPLETE']}")

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    run()
