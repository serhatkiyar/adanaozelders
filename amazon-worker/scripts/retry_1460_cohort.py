import json
import sys
import os
import time

sys.path.append(os.path.abspath('backend'))
from amazon_analyzer.client import call_sp_api

CHK_PRICING = 'scan_checkpoint_pricing.json'
CHK_FEES = 'scan_checkpoint_fees_mfn.json'
CHK_CATALOG = 'scan_checkpoint_catalog.json'
MARKETPLACE_ID = 'A33AVAJ2PDY3EV'

def run():
    pricing_chk = json.load(open(CHK_PRICING, 'r', encoding='utf-8'))
    fees_chk = json.load(open(CHK_FEES, 'r', encoding='utf-8'))
    catalog = json.load(open(CHK_CATALOG, 'r', encoding='utf-8'))

    target_asins = []
    
    for pid, c in catalog.items():
        if c.get('match_status') == 'MATCHED':
            asin = c.get('amazon_asin')
            price = pricing_chk.get(asin, {}).get('amazon_price')
            if price is not None:
                fee = fees_chk.get(asin, {}).get('amazon_fee')
                status = fees_chk.get(asin, {}).get('status')
                if fee is None and status == 'ERROR':
                    # Ensure we don't duplicate
                    found = False
                    for existing in target_asins:
                        if existing[0] == asin:
                            found = True
                            break
                    if not found:
                        target_asins.append((asin, price))

    print(f"INPUT_ERROR_COHORT: {len(target_asins)}", flush=True)
    if len(target_asins) != 1460:
        print("ERROR: Cohort count is not exactly 1460. Stopping.")
        sys.exit(1)

    stats = {
        "SUCCESS": 0,
        "INTERNAL_ERROR": 0,
        "OTHER_ERROR": 0,
        "RETRY_EXHAUSTED": 0
    }

    for i, (asin, price) in enumerate(target_asins):
        if (i+1) % 50 == 0:
            print(f"Processed {i+1}/{len(target_asins)}... (Success: {stats['SUCCESS']}, Internal: {stats['INTERNAL_ERROR']}, Other: {stats['OTHER_ERROR']})", flush=True)
            with open(CHK_FEES, 'w', encoding='utf-8') as f:
                json.dump(fees_chk, f, indent=2, ensure_ascii=False)
            
        req = {
            'FeesEstimateRequest': {
                'MarketplaceId': MARKETPLACE_ID,
                'IsAmazonFulfilled': False,
                'PriceToEstimateFees': {
                    'ListingPrice': {'CurrencyCode': 'TRY', 'Amount': price}
                },
                'Identifier': asin
            }
        }
        
        for attempt in range(4):
            try:
                res = call_sp_api('POST', f'/products/fees/v0/items/{asin}/feesEstimate', data=req)
                
                result = res.get('payload', {}).get('FeesEstimateResult', {})
                status = result.get('Status')
                
                if status == 'Success':
                    est = result.get('FeesEstimate', {})
                    total_fee = est.get('TotalFeesEstimate', {}).get('Amount')
                    if total_fee is not None:
                        # Raw fee components
                        raw_components = est.get('FeeDetailList', [])
                        fees_chk[asin] = {
                            "amazon_fee": total_fee, 
                            "status": "SUCCESS",
                            "raw_components": raw_components
                        }
                        stats["SUCCESS"] += 1
                    else:
                        fees_chk[asin] = {"status": "ERROR", "error_message": "Success response missing Amount field"}
                        stats["OTHER_ERROR"] += 1
                else:
                    err = result.get('Error', {})
                    err_code = err.get('Code', 'Unknown')
                    err_msg = err.get('Message', '')
                    fees_chk[asin] = {
                        "status": "ERROR", 
                        "error_code": err_code,
                        "error_message": err_msg
                    }
                    
                    if err_code == 'InternalError':
                        stats["INTERNAL_ERROR"] += 1
                    else:
                        stats["OTHER_ERROR"] += 1
                break
            except Exception as e:
                err_str = str(e).lower()
                if "429" in err_str or "rate limit" in err_str:
                    time.sleep(1.0 * (2 ** attempt))
                elif "500" in err_str or "503" in err_str:
                    time.sleep(2.0 * (2 ** attempt))
                else:
                    fees_chk[asin] = {"status": "ERROR", "error_code": "HTTP_ERROR", "error_message": str(e)}
                    stats["OTHER_ERROR"] += 1
                    break
        else:
            fees_chk[asin] = {"status": "ERROR", "error_code": "RETRY_EXHAUSTED"}
            stats["RETRY_EXHAUSTED"] += 1
            
    with open(CHK_FEES, 'w', encoding='utf-8') as f:
        json.dump(fees_chk, f, indent=2, ensure_ascii=False)

    print("\n==================================================")
    print("1460 COHORT RETRY RESULTS")
    print("==================================================")
    print(f"INPUT_ERROR_COHORT       : {len(target_asins)}")
    print(f"SUCCESS                  : {stats['SUCCESS']}")
    print(f"INTERNAL_ERROR           : {stats['INTERNAL_ERROR']}")
    print(f"OTHER_ERROR              : {stats['OTHER_ERROR']}")
    print(f"RETRY_EXHAUSTED          : {stats['RETRY_EXHAUSTED']}")
    print("--------------------------------------------------")
    print(f"SUM                      : {sum(stats.values())}")
        
if __name__ == "__main__":
    run()
