import json
import sys
import os
import time

sys.path.append(os.path.abspath("backend"))
from amazon_analyzer.client import call_sp_api

CHK_PRICING = "scan_checkpoint_pricing.json"
CHK_FEES = "scan_checkpoint_fees_mfn.json"
CHK_CATALOG = "scan_checkpoint_catalog.json"
MARKETPLACE_ID = "A33AVAJ2PDY3EV"
SLEEP_BETWEEN = 0.25  # 4 req/sec, well under 10 req/sec limit

def run():
    pricing_chk = json.load(open(CHK_PRICING, "r", encoding="utf-8"))
    fees_chk = json.load(open(CHK_FEES, "r", encoding="utf-8"))
    cat = json.load(open(CHK_CATALOG, "r", encoding="utf-8"))

    pids = [p for p, c in cat.items() if c.get("semantic_confidence") in ["HIGH", "MEDIUM"]]
    need_fees = []
    for p in pids:
        asin = cat[p].get("amazon_asin")
        if not asin: continue
        has_price = pricing_chk.get(asin, {}).get("amazon_price") is not None
        has_fee = fees_chk.get(asin, {}).get("amazon_fee") is not None
        if has_price and not has_fee:
            need_fees.append(asin)

    print(f"Need fees: {len(need_fees)}", flush=True)

    success = 0
    incomplete = 0
    for idx, asin in enumerate(need_fees):
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

        done = False
        for attempt in range(8):
            try:
                res = call_sp_api("POST", f"/products/fees/v0/items/{asin}/feesEstimate", data=req)
                est = res.get("payload", {}).get("FeesEstimateResult", {}).get("FeesEstimate", {})
                total_fee = est.get("TotalFeesEstimate", {}).get("Amount")

                if total_fee is not None:
                    fees_chk[asin] = {"amazon_fee": total_fee, "status": "SUCCESS"}
                    success += 1
                else:
                    fees_chk[asin] = {"status": "FEE_INCOMPLETE"}
                    incomplete += 1
                done = True
                break
            except Exception as e:
                err_str = str(e).lower()
                if "rate limit" in err_str or "429" in err_str:
                    wait = SLEEP_BETWEEN * (2 ** attempt)
                    time.sleep(wait)
                else:
                    incomplete += 1
                    done = True
                    break

        if not done:
            fees_chk[asin] = {"status": "FEE_INCOMPLETE"}
            incomplete += 1

        time.sleep(SLEEP_BETWEEN)

        # Checkpoint every 50
        if (idx + 1) % 50 == 0:
            with open(CHK_FEES, "w", encoding="utf-8") as f:
                json.dump(fees_chk, f, indent=2, ensure_ascii=False)
            print(f"[{idx+1}/{len(need_fees)}] Success: {success} | Incomplete: {incomplete}", flush=True)

    with open(CHK_FEES, "w", encoding="utf-8") as f:
        json.dump(fees_chk, f, indent=2, ensure_ascii=False)

    print(f"\n=== FEE RETRY DONE ===")
    print(f"Success   : {success}")
    print(f"Incomplete: {incomplete}")

    # Rebuild funnel
    f_stats = {
        "active_offer": 0, "no_offer": 0, "fee_success": 0, "fee_incomplete": 0,
        "verified_cost": 0, "positive_contribution": 0,
        "AUTO": 0, "REVIEW": 0, "REJECT": 0, "FEE_INCOMPLETE": 0
    }

    cost_chk = json.load(open("scan_checkpoint_cost.json", "r", encoding="utf-8"))

    eligible_pids = [p for p, c in cat.items() if c.get("semantic_confidence") in ["HIGH", "MEDIUM"]]
    for pid in eligible_pids:
        c = cat[pid]
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
    print("973 ELIGIBLE NON-BOOK COHORT FINAL FUNNEL")
    print("==================================================")
    print(f"RECOVERED_MATCHED        : {len(eligible_pids)}")
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
    total_check = f_stats['AUTO'] + f_stats['REVIEW'] + f_stats['REJECT'] + f_stats['FEE_INCOMPLETE']
    print(f"TOTAL CHECK              : {total_check} (Expected: {len(eligible_pids)})")

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    run()
