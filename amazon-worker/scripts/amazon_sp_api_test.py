import os
import sys
import json
import time
import requests
from datetime import datetime, timezone
from dotenv import load_dotenv

# Load env variables from the root .env file if running locally
# (In production Docker, these will be injected via docker-compose env_file)
env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), '.env')
load_dotenv(env_path)

# --- Configuration ---
CLIENT_ID = os.environ.get("AMAZON_SP_API_CLIENT_ID")
CLIENT_SECRET = os.environ.get("AMAZON_SP_API_CLIENT_SECRET")
REFRESH_TOKEN = os.environ.get("AMAZON_SP_API_REFRESH_TOKEN")
REGION = os.environ.get("AMAZON_SP_API_REGION", "eu")
MARKETPLACE_ID = os.environ.get("AMAZON_SP_API_MARKETPLACE_ID", "A33AVAJ2PDY3EV")
ENDPOINT = os.environ.get("AMAZON_SP_API_ENDPOINT", "https://sellingpartnerapi-eu.amazon.com")

USER_AGENT = "AdanaOzelDersAmazonAnalyzer/0.1 (Language=Python/3.12)"

# --- Token Cache ---
_token_cache = {
    "access_token": None,
    "expires_at": 0  # Unix timestamp
}

def get_access_token() -> str:
    """
    Retrieves the LWA access token. Uses an in-memory cache to avoid requesting a new token
    if the current one is still valid. Includes a 5-minute safety margin before expiration.
    """
    global _token_cache
    now = time.time()
    
    # Check cache with 5 minutes (300 seconds) safety margin
    if _token_cache["access_token"] and _token_cache["expires_at"] > (now + 300):
        return _token_cache["access_token"]
        
    print("[INFO] Requesting new LWA Access Token from Amazon...")
    
    url = "https://api.amazon.com/auth/o2/token"
    headers = {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    }
    payload = {
        "grant_type": "refresh_token",
        "refresh_token": REFRESH_TOKEN,
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET
    }
    
    try:
        response = requests.post(url, headers=headers, data=payload, timeout=10)
    except requests.exceptions.RequestException as e:
        print(f"[ERROR] LWA Token Request Network Error: {str(e)}")
        sys.exit(1)
        
    if response.status_code == 200:
        data = response.json()
        access_token = data.get("access_token")
        expires_in = data.get("expires_in", 3600)  # usually 3600 seconds
        
        _token_cache["access_token"] = access_token
        _token_cache["expires_at"] = now + expires_in
        
        print("[OK] LWA Access Token obtained successfully and cached.")
        return access_token
    else:
        print(f"[ERROR] Failed to obtain LWA Access Token. Status: {response.status_code}")
        _handle_error_response(response, is_auth=True)
        sys.exit(1)

def _handle_error_response(response: requests.Response, is_auth: bool = False):
    """
    Safely prints error responses without exposing full tokens.
    """
    print(f"HTTP Status: {response.status_code}")
    
    # Try to extract Request ID from headers (useful for Amazon Support)
    req_id = response.headers.get('x-amzn-RequestId')
    if req_id:
        print(f"Amazon Request ID: {req_id}")
        
    if response.status_code == 401:
        print("Reason: 401 Unauthorized. The access token might be invalid, expired, or the credentials are wrong.")
    elif response.status_code == 403:
        print("Reason: 403 Forbidden. Your app might be missing the required IAM roles, or the Developer Profile hasn't propagated fully.")
    elif response.status_code == 429:
        print("Reason: 429 Too Many Requests (Rate Limit Exceeded).")
        rate_limit = response.headers.get("x-amzn-RateLimit-Limit")
        if rate_limit:
            print(f"Rate Limit Header: {rate_limit}")
    elif response.status_code >= 500:
        print("Reason: 5xx Amazon Internal Server Error. The SP-API is currently experiencing issues.")
        
    try:
        error_body = response.json()
        # Ensure we don't accidentally print our credentials in the dump if they were echoed
        dump_str = json.dumps(error_body, indent=2)
        if CLIENT_SECRET and CLIENT_SECRET in dump_str:
            dump_str = dump_str.replace(CLIENT_SECRET, "***SECRET_REDACTED***")
        if REFRESH_TOKEN and REFRESH_TOKEN in dump_str:
            dump_str = dump_str.replace(REFRESH_TOKEN, "***TOKEN_REDACTED***")
            
        print(f"Response Body:\n{dump_str}")
    except ValueError:
        print(f"Raw Response: {response.text[:200]}...")

def get_marketplace_participations():
    """
    Calls GET /sellers/v1/marketplaceParticipations
    to verify SP-API access and retrieve the seller's active marketplaces.
    Uses the modern IAM-less authentication method (just access token and headers).
    """
    access_token = get_access_token()
    
    # Remove 'https://' to get just the host name
    host = ENDPOINT.replace("https://", "")
    
    # Current date in ISO8601 format (e.g., 20241001T123000Z)
    amz_date = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    
    url = f"{ENDPOINT}/sellers/v1/marketplaceParticipations"
    
    # Modern SP-API Headers (No AWS SigV4 needed for this endpoint in modern apps)
    headers = {
        "host": host,
        "x-amz-access-token": access_token,
        "x-amz-date": amz_date,
        "user-agent": USER_AGENT,
        "Accept": "application/json"
    }
    
    print(f"\n[NETWORK] Calling SP-API Endpoint: {url}")
    print("Headers attached: host, x-amz-access-token, x-amz-date, user-agent")
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
    except requests.exceptions.RequestException as e:
        print(f"[ERROR] SP-API Request Network Error: {str(e)}")
        return
        
    if response.status_code == 200:
        data = response.json()
        participations = data.get("payload", [])
        print("\n[OK] SP-API Connection Successful!")
        print(f"Status Code: 200 OK")
        
        req_id = response.headers.get('x-amzn-RequestId')
        if req_id:
            print(f"Amazon Request ID: {req_id}")
            
        print(f"\nFound {len(participations)} participating marketplaces:")
        
        tr_found = False
        for p in participations:
            mp = p.get("marketplace", {})
            mp_id = mp.get("id")
            name = mp.get("name")
            country = mp.get("countryCode")
            
            print(f" - {name} ({country}) | ID: {mp_id}")
            
            if mp_id == MARKETPLACE_ID:
                tr_found = True
                
        print("\n--- Summary ---")
        if tr_found:
            print(f"[TARGET] Target Marketplace Turkey ({MARKETPLACE_ID}) IS accessible!")
        else:
            print(f"[WARN] Target Marketplace Turkey ({MARKETPLACE_ID}) was NOT found in the participations list.")
    else:
        print(f"\n[ERROR] SP-API Connection Failed.")
        _handle_error_response(response)

def validate_environment():
    """Checks if all required environment variables are set."""
    missing = []
    if not CLIENT_ID: missing.append("AMAZON_SP_API_CLIENT_ID")
    if not CLIENT_SECRET: missing.append("AMAZON_SP_API_CLIENT_SECRET")
    if not REFRESH_TOKEN: missing.append("AMAZON_SP_API_REFRESH_TOKEN")
    
    if missing:
        print("[ERROR] Error: Missing required environment variables:")
        for m in missing:
            print(f" - {m}")
        print("\nPlease add them to your .env file or environment.")
        return False
    return True

if __name__ == "__main__":
    print("=== Adana Özel Ders - Amazon SP-API Authorization Test ===")
    if validate_environment():
        get_marketplace_participations()
    else:
        print("\nGerçek Amazon çağrısı credential olmadığı için doğrulanamadı.")
        sys.exit(1)
