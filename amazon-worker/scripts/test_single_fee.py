import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from amazon_analyzer.fees import get_fee_estimate
from amazon_analyzer.client import call_sp_api

try:
    fee = get_fee_estimate("B0GGD2J6XB", 1252.08)
    print("SUCCESS:", fee)
except Exception as e:
    print("ERROR:", str(e))
