import csv
import json
import logging
import asyncio
import httpx
import re
from typing import Dict, Any, List, Optional
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from amazon_analyzer.normalizer import normalize_identifier
from amazon_analyzer.catalog import search_catalog_items_batch
from amazon_analyzer.pricing import get_item_offers_batch, get_item_offers, parse_pricing_data
from amazon_analyzer.fees import get_fee_estimate

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

CSV_PATH = r"C:\Users\kiyar\Desktop\iş kültür scrapping\outputs\guncel_stok_2026_09_30.csv"
HAR_PATH = r"C:\Users\kiyar\Desktop\b2b.yildirimdagitim.com_Archive [26-09-30 18-45-54].har"
OUTPUT_CSV = "amazon_real_profit_pilot.csv"

def extract_pack_quantity(title: str) -> Optional[int]:
    if not title: return None
    m = re.search(r'\b(\d+)\s*(?:[\'’‘`]?\s*[Ll][IİUÜ]\b|ADET\b|PAR[ÇC]A\b|PACK\b)', title, re.IGNORECASE)
    if m: return int(m.group(1))
    m_pack = re.search(r'\bPACK\s+OF\s+(\d+)\b', title, re.IGNORECASE)
    if m_pack: return int(m_pack.group(1))
    m2 = re.search(r'\bX\s*(\d+)\b', title, re.IGNORECASE)
    if m2: return int(m2.group(1))
    m3 = re.search(r'\b(\d+)\s*X\b', title, re.IGNORECASE)
    if m3: return int(m3.group(1))
    return None

def extract_token_from_har(har_path: str) -> Optional[str]:
    with open(har_path, 'r', encoding='utf-8') as f:
        har_data = json.load(f)
    for entry in har_data['log']['entries']:
        req = entry['request']
        for header in req['headers']:
            if header['name'].lower() == 'authorization' and 'Bearer' in header['value']:
                return header['value'].replace('Bearer ', '').strip()
    return None

async def fetch_b2b_prices(stok_ids: List[int], token: str) -> Dict[int, Any]:
    url = "https://b2b.yildirimdagitim.com/api/vitrin/fiyat"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": "chrome124",
        "Content-Type": "application/json"
    }
    payload = {"stokIds": stok_ids, "kirilim": True}
    
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, json=payload, headers=headers)
        if r.status_code != 200:
            logger.error(f"B2B API Error: {r.status_code}")
            return {}
        return r.json()

async def run_pilot():
    token = extract_token_from_har(HAR_PATH)
    if not token:
        logger.error("No token found in HAR.")
        return
        
    products = []
    with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f, delimiter=";")
        all_rows = list(reader)
        all_rows.sort(key=lambda x: int(x["id"]) if x.get("id") else 0)
        
        for row in all_rows:
            stok = int(row.get("stok", 0)) if str(row.get("stok", "0")).isdigit() else 0
            barkod = row.get("barkod", "").strip()
            if barkod and stok > 0:
                products.append(row)
                if len(products) >= 100:
                    break
            
    logger.info(f"📦 Selected {len(products)} supplier items for E2E pilot.")
    
    # 1. Fetch B2B Prices
    stok_ids = [int(p['id']) for p in products]
    b2b_response = await fetch_b2b_prices(stok_ids, token)
    fiyatlar = b2b_response.get('fiyatlar', {})
    kirilim = b2b_response.get('kirilim', {})
    
    results = []
    
    valid_items = []
    
    # Enrich with B2B cost
    for prod in products:
        pid = int(prod['id'])
        f_data = fiyatlar.get(str(pid)) or fiyatlar.get(pid, {})
        k_data = kirilim.get(str(pid)) or kirilim.get(pid, [])
        
        sup_min_order = int(prod['min_siparis']) if prod.get('min_siparis') else 1
        
        result_row = {
            "supplier_product_id": pid,
            "supplier_code": prod.get("kod"),
            "supplier_title": prod.get("ad"),
            "barcode": prod.get("barkod"),
            
            "supplier_list_price": None,
            "supplier_discount_rates": None,
            "supplier_net_price_ex_vat": None,
            "supplier_vat_rate": None,
            "supplier_cost_inc_vat": None,
            "supplier_min_order_quantity": sup_min_order,
            "supplier_min_order_cash_outlay": None,
            "supplier_cost_confidence": "UNVERIFIED",
            
            "match_status": "PENDING",
            "asin": None,
            "amazon_title": None,
            "pack_quantity_supplier": extract_pack_quantity(prod.get("ad")),
            "pack_quantity_amazon": None,
            "pack_quantity_status": "UNKNOWN",
            
            "lowest_new_landed_price": None,
            "featured_offer_price": None,
            "amazon_fee_estimate": None,
            "analysis_status": "PENDING",
            "analysis_error": None,
            
            "estimated_contribution_before_shipping": None,
            "estimated_margin_before_shipping_pct": None,
            "minimum_purchase_cash_required": None
        }
        
        if f_data:
            pesin_k = next((k for k in k_data if k.get('altHesapId') == 2), None)
            
            result_row["supplier_list_price"] = f_data.get('taban')
            result_row["supplier_vat_rate"] = f_data.get('kdv')
            
            if pesin_k:
                net_ex_vat = float(pesin_k.get('net', 0))
                vat_rate = float(f_data.get('kdv', 0))
                inc_vat = round(net_ex_vat * (1 + vat_rate / 100), 2)
                
                result_row["supplier_net_price_ex_vat"] = net_ex_vat
                result_row["supplier_discount_rates"] = str(pesin_k.get('iskontolar', []))
                result_row["supplier_cost_inc_vat"] = inc_vat
                result_row["supplier_min_order_cash_outlay"] = inc_vat * sup_min_order
                result_row["minimum_purchase_cash_required"] = inc_vat * sup_min_order
                result_row["supplier_cost_confidence"] = "VERIFIED_LIVE"
        
        # Guard identifier
        raw_id = prod.get("barkod")
        norm_barcode, id_type, is_valid = normalize_identifier(raw_id)
        
        if not is_valid:
            result_row["match_status"] = "INVALID_IDENTIFIER"
            result_row["analysis_status"] = "INVALID_IDENTIFIER"
            results.append(result_row)
        else:
            result_row["identifier_normalized"] = norm_barcode
            result_row["identifier_type"] = id_type
            valid_items.append((result_row, prod))

    # 2. Amazon Catalog
    items_by_type = {}
    for row, prod in valid_items:
        typ = row["identifier_type"]
        items_by_type.setdefault(typ, []).append((row, prod))
        
    for typ, type_group in items_by_type.items():
        # Split into batches of 20
        chunk_size = 20
        for i in range(0, len(type_group), chunk_size):
            chunk = type_group[i:i+chunk_size]
            identifiers = [r["identifier_normalized"] for r, _ in chunk]
            
            try:
                catalog_matches = search_catalog_items_batch(identifiers, typ)
                
                matched_rows = []
                for result_row, prod in chunk:
                    norm = result_row["identifier_normalized"]
                    matched_items = []
                    for cat_item in catalog_matches:
                        for ident in cat_item.get("identifiers", []):
                            ids = ident.get("identifiers", [])
                            for id_obj in ids:
                                if id_obj.get("identifier") == norm and id_obj.get("identifierType") == typ:
                                    matched_items.append(cat_item)
                                    break
                    
                    if not matched_items:
                        result_row["match_status"] = "NOT_FOUND"
                        result_row["analysis_status"] = "NOT_FOUND"
                    elif len(matched_items) > 1:
                        result_row["match_status"] = "AMBIGUOUS"
                        result_row["analysis_status"] = "AMBIGUOUS"
                    else:
                        result_row["match_status"] = "MATCHED"
                        
                        item = matched_items[0]
                        asin = item.get("asin")
                        result_row["asin"] = asin
                        
                        summaries = item.get("summaries", [])
                        if summaries:
                            result_row["amazon_title"] = summaries[0].get("itemName")
                            result_row["pack_quantity_amazon"] = extract_pack_quantity(result_row["amazon_title"])
                            
                            pq_sup = result_row["pack_quantity_supplier"]
                            pq_amz = result_row["pack_quantity_amazon"]
                            if pq_sup is not None and pq_amz is not None:
                                if pq_sup == pq_amz:
                                    result_row["pack_quantity_status"] = "MATCH"
                                else:
                                    result_row["pack_quantity_status"] = "MISMATCH"
                            else:
                                result_row["pack_quantity_status"] = "UNKNOWN"
                        
                        matched_rows.append(result_row)
                    
                    results.append(result_row)

                # 3. Amazon Pricing
                if matched_rows:
                    asins = [r["asin"] for r in matched_rows]
                    batch_responses = get_item_offers_batch(asins)
                    
                    for r_row in matched_rows:
                        asin = r_row["asin"]
                        offer_res = None
                        for res in batch_responses:
                            if res.get("body", {}).get("payload", {}).get("ASIN") == asin:
                                offer_res = res
                                break
                                
                        if offer_res and offer_res.get("status", {}).get("statusCode") == 200:
                            pricing_data = parse_pricing_data(offer_res.get("body", {}))
                            r_row.update(pricing_data)
                            
                        candidate_price = r_row.get("featured_offer_price") or r_row.get("lowest_new_landed_price")
                        
                        if candidate_price:
                            r_row["analysis_status"] = "PRICED"
                            
                            if r_row["pack_quantity_status"] == "MISMATCH":
                                r_row["analysis_status"] = "PACK_MISMATCH"
                                continue
                                
                            # 4. Amazon Fees
                            try:
                                fee_est = get_fee_estimate(asin, candidate_price)
                                r_row["amazon_fee_estimate"] = fee_est
                                if fee_est is None:
                                    r_row["analysis_status"] = "FEE_ERROR"
                                else:
                                    r_row["analysis_status"] = "FEE_OK"
                                    
                                    # 5. Profitability
                                    cost = r_row.get("supplier_cost_inc_vat")
                                    if cost is not None:
                                        profit = float(candidate_price) - float(fee_est) - cost
                                        r_row["estimated_contribution_before_shipping"] = round(profit, 2)
                                        r_row["estimated_margin_before_shipping_pct"] = round((profit / float(candidate_price)) * 100, 2)
                            except Exception as e:
                                r_row["analysis_error"] = f"Fees Error: {e}"
                                r_row["analysis_status"] = "FEE_ERROR"
                        else:
                            r_row["analysis_status"] = "NO_OFFERS"

            except Exception as e:
                logger.error(f"Error processing catalog chunk: {e}")
                
    # Write output
    fieldnames = [
        "supplier_product_id", "supplier_code", "supplier_title", "barcode",
        "supplier_list_price", "supplier_discount_rates", "supplier_net_price_ex_vat", 
        "supplier_vat_rate", "supplier_cost_inc_vat", "supplier_min_order_quantity", 
        "supplier_min_order_cash_outlay", "minimum_purchase_cash_required", "supplier_cost_confidence",
        "match_status", "asin", "amazon_title", "pack_quantity_supplier", "pack_quantity_amazon", "pack_quantity_status",
        "lowest_new_landed_price", "featured_offer_price", "amazon_fee_estimate",
        "estimated_contribution_before_shipping", "estimated_margin_before_shipping_pct",
        "analysis_status", "analysis_error"
    ]
    
    with open(OUTPUT_CSV, "w", encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(results)
        
if __name__ == "__main__":
    asyncio.run(run_pilot())
