import os
from dotenv import load_dotenv
from sp_api.api import Sellers
from sp_api.base import Marketplaces

# Load credentials from .env file
load_dotenv()

credentials = {
    "refresh_token": os.environ.get("SP_API_REFRESH_TOKEN"),
    "lwa_app_id": os.environ.get("LWA_CLIENT_ID"),
    "lwa_client_secret": os.environ.get("LWA_CLIENT_SECRET")
}

def test_sp_api():
    print("Testing Amazon SP-API connection via saleweaver/python-amazon-sp-api...")
    
    try:
        # We use the Sellers API to get marketplace participations
        # This is a safe endpoint that doesn't require PII or restricted roles
        sellers_api = Sellers(credentials=credentials, marketplace=Marketplaces.TR)
        
        response = sellers_api.get_marketplace_participations()
        
        print("\n✅ Successfully connected to Amazon SP-API!")
        marketplaces = response.payload
        print(f"Found {len(marketplaces)} participating marketplaces.")
        
        for mp in marketplaces:
            print(f" - {mp['marketplace']['name']} ({mp['marketplace']['countryCode']})")
            
    except Exception as e:
        print("\n❌ SP-API request failed.")
        print(str(e))
        print("\nNOTE: If you get a 403 Forbidden error, ensure that:")
        print("1. Your app has the 'Seller Insights' or relevant roles.")
        print("2. You might need to wait 15-30 mins for Amazon to fully propagate the new authorization.")
        print("3. If your Amazon Developer account still strictly requires AWS IAM (older setup), you might need AWS_ACCESS_KEY, AWS_SECRET_KEY, and ROLE_ARN.")

if __name__ == "__main__":
    test_sp_api()
