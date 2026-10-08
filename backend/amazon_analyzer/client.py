import time
import json
import random
import logging
import requests
from datetime import datetime, timezone
from typing import Dict, Any

from .auth import get_access_token, ENDPOINT

logger = logging.getLogger(__name__)

USER_AGENT = "AdanaOzelDersAmazonAnalyzer/1.0 (Language=Python/3.12)"

class SpApiClientError(Exception):
    pass

class SpApiRateLimitError(SpApiClientError):
    pass

def call_sp_api(method: str, path: str, params: Dict[str, Any] = None, data: Dict[str, Any] = None) -> Dict[str, Any]:
    """
    Makes a request to the SP-API with exponential backoff and jitter for 429 responses.
    """
    max_retries = 0
    base_delay = 2.0
    
    url = f"{ENDPOINT}{path}"
    host = ENDPOINT.replace("https://", "")
    
    for attempt in range(max_retries + 1):
        access_token = get_access_token()
        amz_date = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        
        headers = {
            "host": host,
            "x-amz-access-token": access_token,
            "x-amz-date": amz_date,
            "user-agent": USER_AGENT,
            "Accept": "application/json"
        }
        
        if data:
            headers["Content-Type"] = "application/json"
            
        try:
            if method.upper() == "GET":
                response = requests.get(url, headers=headers, params=params, timeout=15)
            else:
                response = requests.request(method.upper(), url, headers=headers, params=params, json=data, timeout=15)
        except requests.exceptions.RequestException as e:
            if attempt < max_retries:
                time.sleep(base_delay * (2 ** attempt) + random.uniform(0, 1))
                continue
            raise SpApiClientError(f"Network error: {str(e)}")

        # Proactive Rate Limiting Parsing
        rate_limit_header = response.headers.get("x-amzn-RateLimit-Limit")
        if rate_limit_header:
            try:
                rate_limit = float(rate_limit_header)
            except ValueError:
                rate_limit = 0.1 if "pricing" in path else (1.0 if "fees" in path else 1.0)
        else:
            rate_limit = 0.1 if "pricing" in path else (1.0 if "fees" in path else 1.0)
            
        # Calculate refill time
        if "batches" in path:
            refill_delay = 2.1
        else:
            refill_delay = 1.0 / rate_limit if rate_limit > 0 else 10.0

        if response.status_code == 200:
            # We succeed, but we sleep to respect token bucket for the next call
            # A true token bucket would track timestamps, but a sleep is safe fallback
            time.sleep(refill_delay)
            return response.json()
            
        elif response.status_code == 429:
            logger.warning(f"429 Rate Limit Exceeded on {path}. Limit header: {rate_limit_header or 'Missing'}")
            if attempt < max_retries:
                delay = base_delay * (2 ** attempt) + random.uniform(0, 1)
                # Sleep the max of backoff and the refill delay
                time.sleep(max(delay, refill_delay))
                continue
            raise SpApiRateLimitError(f"Rate limited after {max_retries} retries.")
            
        elif response.status_code >= 500:
            logger.error(f"Amazon 5xx Error on {path}: {response.text}")
            if attempt < max_retries:
                time.sleep(base_delay * (2 ** attempt))
                continue
            raise SpApiClientError(f"Amazon internal error: {response.status_code}")
            
        else:
            req_id = response.headers.get("x-amzn-RequestId")
            logger.error(f"SP-API Error {response.status_code} on {path}. ReqID: {req_id}")
            logger.error(f"Response: {response.text}")
            raise SpApiClientError(f"HTTP {response.status_code}: {response.text}")

    raise SpApiClientError("Exceeded max retries")
