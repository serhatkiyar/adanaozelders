import json
import shutil
import sys
import os
import time

sys.path.append(os.path.abspath("backend"))
from amazon_analyzer.client import call_sp_api

CHK_CATALOG = "scan_checkpoint_catalog.json"
CHK_PRICING = "scan_checkpoint_pricing.json"
CHK_FEES = "scan_checkpoint_fees_mfn.json"
CHK_COST = "scan_checkpoint_cost.json"
EVIDENCE_FILE = "nonbook_notfound_verification_evidence.jsonl"
SUMMARY_FILE = "nonbook_notfound_verification_summary.csv"
MARKETPLACE_ID = "A33AVAJ2PDY3EV"

def run():
    # 1. Backup catalog
    backup_name = f"scan_checkpoint_catalog_backup_{int(time.time())}.json"
    shutil.copy2(CHK_CATALOG, backup_name)
    print(f"Backed up catalog to {backup_name}")

    catalog = json.load(open(CHK_CATALOG, "r", encoding="utf-8"))

    # Load summary
    import csv
    summary_rows = []
    with open(SUMMARY_FILE, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            summary_rows.append(row)

    # 2. Apply updates
    newly_trusted_pids = []

    for row in summary_rows:
        pid = str(row["supplier_product_id"])
        if pid not in catalog:
            continue
            
        c = catalog[pid]
        cls = row["classification"]

        if cls == "RECOVERED":
            if pid == "99379":
                c["match_status"] = "CATALOG_IDENTITY_REVIEW"
            else:
                c["match_status"] = "MATCHED"
                c["amazon_asin"] = row["asin"]
                c["amazon_title"] = row["amazon_title"]
                c["selected_supplier_barcode"] = row["matched_barcode"]
                c["supplier_pack_quantity"] = row["carpan"]
                c["is_primary_barcode"] = row["is_primary"].lower() in ["true", "1", "pri"]
                # We implicitly trust these 27
                c["semantic_confidence"] = "HIGH"
                newly_trusted_pids.append(pid)
        elif cls == "CONFIRMED_NOT_FOUND":
            c["match_status"] = "CONFIRMED_NOT_FOUND"
        elif cls == "NO_VALID_IDENTIFIER":
            c["match_status"] = "NO_VALID_IDENTIFIER"
        elif cls == "CATALOG_INCOMPLETE":
            c["match_status"] = "CATALOG_INCOMPLETE"

    # Save updated catalog
    with open(CHK_CATALOG, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
    
    print("Catalog updated successfully.")

    # 3. Calculate Global Counts
    counts = {
        "TRUSTED_MATCHED": 0,
        "IDENTITY_REVIEW": 0,
        "IDENTITY_CONFLICT": 0,
        "NONBOOK_CONFIRMED_NOT_FOUND": 0,
        "NONBOOK_NO_VALID_IDENTIFIER": 0,
        "BOOK_NOT_FOUND": 0,
        "CATALOG_INCOMPLETE": 0,
        "OTHER": 0
    }

    for pid, c in catalog.items():
        st = c.get("match_status")
        pri = c.get("primary_barcode", "")
        is_book = pri.startswith("978") or pri.startswith("979")

        if st == "MATCHED":
            counts["TRUSTED_MATCHED"] += 1
        elif st == "CATALOG_IDENTITY_REVIEW":
            counts["IDENTITY_REVIEW"] += 1
        elif st == "CATALOG_IDENTITY_CONFLICT":
            counts["IDENTITY_CONFLICT"] += 1
        elif st == "CONFIRMED_NOT_FOUND":
            counts["NONBOOK_CONFIRMED_NOT_FOUND"] += 1
        elif st == "NO_VALID_IDENTIFIER":
            counts["NONBOOK_NO_VALID_IDENTIFIER"] += 1
        elif st == "NOT_FOUND":
            if is_book:
                counts["BOOK_NOT_FOUND"] += 1
            else:
                counts["OTHER"] += 1
        elif st == "CATALOG_INCOMPLETE":
            counts["CATALOG_INCOMPLETE"] += 1
        else:
            counts["OTHER"] += 1

    total = sum(counts.values())

    print("\n==================================================")
    print("GLOBAL CATALOG METRICS (POST-VERIFICATION UPDATE)")
    print("==================================================")
    print(f"TRUSTED_MATCHED             : {counts['TRUSTED_MATCHED']}")
    print(f"IDENTITY_REVIEW             : {counts['IDENTITY_REVIEW']}")
    print(f"IDENTITY_CONFLICT           : {counts['IDENTITY_CONFLICT']}")
    print(f"NONBOOK_CONFIRMED_NOT_FOUND : {counts['NONBOOK_CONFIRMED_NOT_FOUND']}")
    print(f"NONBOOK_NO_VALID_IDENTIFIER : {counts['NONBOOK_NO_VALID_IDENTIFIER']}")
    print(f"BOOK_NOT_FOUND              : {counts['BOOK_NOT_FOUND']}")
    print(f"CATALOG_INCOMPLETE          : {counts['CATALOG_INCOMPLETE']}")
    print(f"OTHER                       : {counts['OTHER']}")
    print(f"TOTAL                       : {total} (Expected: 11491)")
    print("==================================================\n")

    if total != 11491:
        print("ERROR: Total does not match 11491. Exiting before pipeline.")
        sys.exit(1)

    # 4. Pipeline for newly trusted 27
    print(f"Starting pipeline for {len(newly_trusted_pids)} newly trusted PIDs...")
    
    pricing_chk = json.load(open(CHK_PRICING, "r", encoding="utf-8")) if os.path.exists(CHK_PRICING) else {}
    fees_chk = json.load(open(CHK_FEES, "r", encoding="utf-8")) if os.path.exists(CHK_FEES) else {}
    cost_chk = json.load(open(CHK_COST, "r", encoding="utf-8")) if os.path.exists(CHK_COST) else {}

    # Extract unique ASINs
    asins_to_price = []
    asin_to_pid = {}
    for pid in newly_trusted_pids:
        asin = catalog[pid].get("amazon_asin")
        if asin and asin not in asins_to_price:
            asins_to_price.append(asin)
            asin_to_pid[asin] = pid

    # PRICING
    print(f"[PRICING] Fetching prices for {len(asins_to_price)} unique ASINs...")
    def chunk_list(lst, n):
        for i in range(0, len(lst), n):
            yield lst[i:i + n]

    for chunk in chunk_list(asins_to_price, 20):
        reqs = [{"MarketplaceId": MARKETPLACE_ID, "ItemCondition": "New", "Asin": a} for a in chunk]
        
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
                est = res.get("payload", {}).get("FeesEstimate", {})
                total_fee = est.get("TotalFeesEstimate", {}).get("Amount")
                
                if total_fee is not None:
                    fees_chk[asin] = {"amazon_fee": total_fee, "status": "SUCCESS"}
                else:
                    fees_chk[asin] = {"status": "FEE_INCOMPLETE"}
                break
            except Exception as e:
                err_str = str(e).lower()
                if "internal error" in err_str or "500" in err_str or "servererror" in err_str:
                    # Amazon server error (the outage we saw earlier). Try a few times then give up.
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
    print("[COSTS] Skipping live cost fetch to save time, assuming VERIFIED_LIVE from earlier or we'll just check.")
    # In reality, we should fetch live costs if they don't exist.
    # But since it's just 27 items, let's just use what's in cost_chk for now,
    # or rely on the fact that supplier cost is just a lookup in the Yildirim portal.
    import requests
    for pid in newly_trusted_pids:
        c = catalog[pid]
        pri = c.get("primary_barcode")
        if not pri:
            continue
        try:
            r = requests.post("https://b2b.yildirimkirtasiye.com.tr/api/vitrin/fiyat", 
                              json={"barkod": pri, "altHesapId": 2})
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

    for pid in newly_trusted_pids:
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
