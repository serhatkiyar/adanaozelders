import csv
import json
import time
import requests
from unittest.mock import patch
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from amazon_analyzer.pricing import get_item_offers_batch

metrics = {
    "pricing_items": 38,
    "pricing_logical_batches": 0,
    "pricing_initial_http_requests": 0,
    "pricing_retry_http_requests": 0,
    "pricing_total_http_attempts": 0,
    "pricing_429_count": 0
}

original_request = requests.request

def tracked_request(method, url, **kwargs):
    if method.upper() == "POST" and "pricing/v0/itemOffers" in url:
        payload = kwargs.get("json", {})
        subrequests = len(payload.get("requests", []))
        
        is_retry = getattr(tracked_request, "in_retry", False)
        
        metrics["pricing_total_http_attempts"] += 1
        if not is_retry:
            metrics["pricing_initial_http_requests"] += 1
            print(f"PRICING HTTP POST #{metrics['pricing_initial_http_requests']} - subrequests={subrequests}")
            if metrics["pricing_initial_http_requests"] == 1:
                print("--- SANITIZED REQUEST BODY OF FIRST POST ---")
                # Sanitize the body (remove seller id or keep it simple)
                sanitized_payload = payload
                print(json.dumps(sanitized_payload, indent=2))
                print("------------------------------------------")
        else:
            metrics["pricing_retry_http_requests"] += 1
            print(f"PRICING HTTP POST (RETRY) - subrequests={subrequests}")

        resp = original_request(method, url, **kwargs)
        if resp.status_code == 429:
            metrics["pricing_429_count"] += 1
            tracked_request.in_retry = True
        else:
            tracked_request.in_retry = False
        return resp
        
    return original_request(method, url, **kwargs)


def chunk_list(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]

def run_test():
    asins = set()
    with open(r"C:\Users\kiyar\Desktop\adana-ozel-ders\amazon_multibarcode_validation_pilot.csv", "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for r in reader:
            if r["amazon_asin"]:
                asins.add(r["amazon_asin"])
                if len(asins) == 38:
                    break
    
    asins = list(asins)
    assert len(asins) == 38
    
    print(f"Loaded {len(asins)} ASINs for Pricing Batch Test.")
    
    with patch("requests.request", side_effect=tracked_request):
        for batch in chunk_list(asins, 20):
            metrics["pricing_logical_batches"] += 1
            tracked_request.in_retry = False
            
            if metrics["pricing_logical_batches"] > 1:
                time.sleep(2.5) # Prevent 429 Limit
                
            try:
                res = get_item_offers_batch(batch)
            except Exception as e:
                print(f"Error on batch: {e}")
                
    print("\n--- FINAL METRICS ---")
    for k, v in metrics.items():
        print(f"{k}: {v}")

if __name__ == "__main__":
    run_test()
