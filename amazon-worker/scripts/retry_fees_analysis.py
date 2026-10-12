import json
import sys
import os
import time

sys.path.append(os.path.abspath('backend'))
from amazon_analyzer.client import call_sp_api

CHK_PRICING = 'scan_checkpoint_pricing.json'
CHK_FEES = 'scan_checkpoint_fees_mfn.json'
MARKETPLACE_ID = 'A33AVAJ2PDY3EV'

def run():
    pricing_chk = json.load(open(CHK_PRICING, 'r', encoding='utf-8'))
    fees_chk = json.load(open(CHK_FEES, 'r', encoding='utf-8'))

    target_asins = []
    for asin, fdata in fees_chk.items():
        if fdata.get('status') == 'FEE_INCOMPLETE':
            price = pricing_chk.get(asin, {}).get('amazon_price')
            if price is not None:
                target_asins.append((asin, price))

    print(f"Retrying {len(target_asins)} FEE_INCOMPLETE ASINs...", flush=True)

    stats = {
        "success": 0,
        "DataNotAvailable": 0,
        "InternalError": 0,
        "OtherError": 0
    }
    
    error_details = []

    for i, (asin, price) in enumerate(target_asins):
        if (i+1) % 10 == 0:
            print(f"Processed {i+1}/{len(target_asins)}... (Success: {stats['success']}, DataNotAvail: {stats['DataNotAvailable']}, InternalErr: {stats['InternalError']}, Other: {stats['OtherError']})", flush=True)
            # Save checkpoint every 10 items
            with open(CHK_FEES, 'w', encoding='utf-8') as f:
                json.dump(fees_chk, f, indent=2, ensure_ascii=False)
            with open('fee_errors.json', 'w', encoding='utf-8') as f:
                json.dump(error_details, f, indent=2, ensure_ascii=False)
            
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
        
        # Max 2 attempts to save time
        for attempt in range(2):
            try:
                res = call_sp_api('POST', f'/products/fees/v0/items/{asin}/feesEstimate', data=req)
                
                result = res.get('payload', {}).get('FeesEstimateResult', {})
                status = result.get('Status')
                
                if status == 'Success':
                    est = result.get('FeesEstimate', {})
                    total_fee = est.get('TotalFeesEstimate', {}).get('Amount')
                    if total_fee is not None:
                        fees_chk[asin] = {"amazon_fee": total_fee, "status": "SUCCESS"}
                        stats["success"] += 1
                    else:
                        fees_chk[asin] = {"status": "FEE_INCOMPLETE"}
                        stats["OtherError"] += 1
                        error_details.append({"asin": asin, "type": "NoAmount", "raw": result})
                else:
                    err = result.get('Error', {})
                    err_code = err.get('Code', 'Unknown')
                    err_msg = err.get('Message', '')
                    fees_chk[asin] = {"status": "FEE_INCOMPLETE", "error_code": err_code}
                    
                    if err_code == 'DataNotAvailable':
                        stats["DataNotAvailable"] += 1
                    elif err_code == 'InternalError':
                        stats["InternalError"] += 1
                    else:
                        stats["OtherError"] += 1
                        
                    error_details.append({
                        "asin": asin,
                        "code": err_code,
                        "msg": err_msg,
                        "raw": err
                    })
                break
            except Exception as e:
                err_str = str(e).lower()
                if "429" in err_str or "rate limit" in err_str:
                    time.sleep(1.0 * (2 ** attempt))
                else:
                    fees_chk[asin] = {"status": "FEE_INCOMPLETE", "error_code": "HTTP_ERROR"}
                    stats["OtherError"] += 1
                    error_details.append({"asin": asin, "code": "HTTP_ERROR", "msg": str(e)})
                    break
        else:
            fees_chk[asin] = {"status": "FEE_INCOMPLETE", "error_code": "RETRY_EXHAUSTED"}
            stats["OtherError"] += 1
            error_details.append({"asin": asin, "code": "RETRY_EXHAUSTED", "msg": "Exhausted retries"})
            
        time.sleep(0.15) # rate limit

    with open(CHK_FEES, 'w', encoding='utf-8') as f:
        json.dump(fees_chk, f, indent=2, ensure_ascii=False)

    print("\n--- RETRY RESULTS ---", flush=True)
    print(f"Total processed     : {len(target_asins)}", flush=True)
    print(f"SUCCESS (recovered) : {stats['success']}", flush=True)
    print(f"DataNotAvailable    : {stats['DataNotAvailable']} (Usually Missing Dimensions)", flush=True)
    print(f"InternalError       : {stats['InternalError']}", flush=True)
    print(f"OtherError          : {stats['OtherError']}", flush=True)
    
    with open('fee_errors.json', 'w', encoding='utf-8') as f:
        json.dump(error_details, f, indent=2, ensure_ascii=False)
        
if __name__ == "__main__":
    run()
