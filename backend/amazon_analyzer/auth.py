import os
import time
import requests
import logging
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Load env in case it's run standalone
env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), '.env')
load_dotenv(env_path)

CLIENT_ID = os.environ.get("AMAZON_SP_API_CLIENT_ID")
CLIENT_SECRET = os.environ.get("AMAZON_SP_API_CLIENT_SECRET")
REFRESH_TOKEN = os.environ.get("AMAZON_SP_API_REFRESH_TOKEN")
ENDPOINT = os.environ.get("AMAZON_SP_API_ENDPOINT", "https://sellingpartnerapi-eu.amazon.com")
MARKETPLACE_ID = os.environ.get("AMAZON_SP_API_MARKETPLACE_ID", "A33AVAJ2PDY3EV")

_token_cache = {
    "access_token": None,
    "expires_at": 0
}

def get_access_token() -> str:
    """
    Retrieves LWA access token. Uses an in-memory cache with a 5-minute safety margin.
    """
    global _token_cache
    now = time.time()
    
    if _token_cache["access_token"] and _token_cache["expires_at"] > (now + 300):
        return _token_cache["access_token"]
        
    url = "https://api.amazon.com/auth/o2/token"
    headers = {"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"}
    payload = {
        "grant_type": "refresh_token",
        "refresh_token": REFRESH_TOKEN,
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET
    }
    
    response = requests.post(url, headers=headers, data=payload, timeout=10)
    
    if response.status_code == 200:
        data = response.json()
        _token_cache["access_token"] = data.get("access_token")
        _token_cache["expires_at"] = now + data.get("expires_in", 3600)
        return _token_cache["access_token"]
    else:
        logger.error(f"LWA Token Request Failed. HTTP {response.status_code}")
        # Redact secrets
        resp_text = response.text.replace(str(CLIENT_SECRET), "***").replace(str(REFRESH_TOKEN), "***")
        logger.error(f"LWA Response: {resp_text}")
        raise RuntimeError("Failed to obtain LWA Access Token. Check credentials.")
