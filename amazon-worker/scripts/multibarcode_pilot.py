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
from amazon_analyzer.pricing import get_item_offers_batch, parse_pricing_data
from amazon_analyzer.fees import get_fee_estimate

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

CSV_PATH = r"C:\Users\kiyar\Desktop\iş kültür scrapping\outputs\guncel_stok_2026_09_30.csv"
HAR_PATH = r"C:\Users\kiyar\Desktop\b2b.yildirimdagitim.com_Archive [26-09-30 18-45-54].har"
OUTPUT_CSV = "amazon_multibarcode_validation_pilot.csv"

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
        "User-Agent": "chrome"
    }
    payload = {"stokIds": stok_ids, "kirilim": True}
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.post(url, json=payload, headers=headers)
            if r.status_code == 200:
                return r.json()
        except: pass
    return {}

async def fetch_product_details(stok_id: int) -> Dict[str, Any]:
    url = f"https://b2b.yildirimdagitim.com/api/vitrin/urun/{stok_id}"
    headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.0"}
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(url, headers=headers)
            if r.status_code == 200:
                return r.json()
        except: pass
    return {}

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

async def run_multibarcode_pilot():
    token = extract_token_from_har(HAR_PATH)
    
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
                    
    logger.info(f"Loaded {len(products)} products.")
    stok_ids = [int(p['id']) for p in products]
    b2b_price_data = await fetch_b2b_prices(stok_ids, token) if token else {}
    fiyatlar = b2b_price_data.get('fiyatlar', {})
    kirilim = b2b_price_data.get('kirilim', {})
    
    results = []
    
    # Track metrics
    metric_multi_barcode_products = 0
    metric_total_alt_barcodes = 0
    metric_new_ambiguity = 0
    metric_pack_mismatches = 0
    metric_auto_opportunity = 0
    metric_review_required = 0
    
    for prod in products:
        pid = int(prod['id'])
        
        # Base cost logic
        sup_cost_inc_vat = None
        f_data = fiyatlar.get(str(pid)) or fiyatlar.get(pid, {})
        k_data = kirilim.get(str(pid)) or kirilim.get(pid, [])
        if f_data:
            pesin_k = next((k for k in k_data if k.get('altHesapId') == 2), None)
            if pesin_k:
                net_ex_vat = float(pesin_k.get('net', 0))
                vat_rate = float(f_data.get('kdv', 0))
                sup_cost_inc_vat = round(net_ex_vat * (1 + vat_rate / 100), 2)

        # Multi-barcode fetch
        p_details = await fetch_product_details(pid)
        barkodlar_arr = p_details.get("barkodlar", [])
        
        candidates = []
        if barkodlar_arr:
            for b_info in barkodlar_arr:
                b = b_info.get("barkod")
                carpan = int(b_info.get("carpan", 1))
                norm_b, id_type, is_valid = normalize_identifier(b)
                if is_valid:
                    candidates.append({"barcode": norm_b, "type": id_type, "carpan": carpan})
        else:
            b = prod.get("barkod")
            norm_b, id_type, is_valid = normalize_identifier(b)
            if is_valid:
                candidates.append({"barcode": norm_b, "type": id_type, "carpan": 1})
                
        # deduplicate
        seen = set()
        uniq_candidates = []
        for c in candidates:
            if c["barcode"] not in seen:
                seen.add(c["barcode"])
                uniq_candidates.append(c)
                
        if len(uniq_candidates) > 1:
            metric_multi_barcode_products += 1
            metric_total_alt_barcodes += (len(uniq_candidates) - 1)
            
        row_base = {
            "supplier_product_id": pid,
            "supplier_title": prod.get("ad"),
            "primary_supplier_barcode": prod.get("barkod"),
            "all_supplier_barcodes": "|".join([c["barcode"] for c in uniq_candidates]),
            "base_unit_cost_inc_vat": sup_cost_inc_vat,
            "match_status": "NOT_FOUND",
            "pack_quantity_status": "UNKNOWN",
            "match_confidence": "UNKNOWN",
            "supplier_cost_confidence": "VERIFIED_LIVE" if sup_cost_inc_vat else "UNVERIFIED"
        }
        
        # Catalog search for all candidates
        amazon_items_found = []
        for c in uniq_candidates:
            cat_res = search_catalog_items_batch([c["barcode"]], c["type"])
            for item in cat_res:
                amazon_items_found.append({"amazon_item": item, "supplier_candidate": c})
                
        if not amazon_items_found:
            results.append(row_base)
            continue
            
        # ASIN selection logic
        # 1. Exact pack match
        # 2. Ambiguous check
        selected_match = None
        ambiguous = False
        
        best_matches = []
        for m in amazon_items_found:
            amz = m["amazon_item"]
            cnd = m["supplier_candidate"]
            
            asin = amz.get("asin")
            title = amz.get("summaries", [{}])[0].get("itemName", "")
            amz_pack = extract_pack_quantity(title)
            
            sup_pack = cnd["carpan"]
            
            is_pack_match = False
            is_mismatch = False
            
            if amz_pack is not None:
                if amz_pack == sup_pack:
                    is_pack_match = True
                else:
                    is_mismatch = True
                    
            best_matches.append({
                "asin": asin,
                "amazon_title": title,
                "amazon_pack": amz_pack,
                "supplier_pack": sup_pack,
                "supplier_barcode": cnd["barcode"],
                "is_pack_match": is_pack_match,
                "is_mismatch": is_mismatch,
                "amazon_item": amz
            })
            
        # Priority filter
        pack_matched = [m for m in best_matches if m["is_pack_match"]]
        unknown_pack = [m for m in best_matches if not m["is_pack_match"] and not m["is_mismatch"]]
        mismatched = [m for m in best_matches if m["is_mismatch"]]
        
        final_match = None
        match_status_desc = ""
        
        if len(pack_matched) == 1:
            final_match = pack_matched[0]
            match_status_desc = "EXACT_BARCODE_EXACT_PACK"
        elif len(pack_matched) > 1:
            ambiguous = True
        elif len(unknown_pack) == 1:
            final_match = unknown_pack[0]
            match_status_desc = "EXACT_BARCODE_PACK_UNKNOWN"
        elif len(unknown_pack) > 1:
            ambiguous = True
        elif len(mismatched) == 1:
            final_match = mismatched[0]
            match_status_desc = "EXACT_BARCODE_PACK_MISMATCH"
            metric_pack_mismatches += 1
        elif len(mismatched) > 1:
            ambiguous = True
            
        if ambiguous:
            metric_new_ambiguity += 1
            row_base["match_status"] = "MULTI_BARCODE_AMBIGUOUS"
            results.append(row_base)
            continue
            
        if final_match:
            row_base["selected_supplier_barcode"] = final_match["supplier_barcode"]
            row_base["supplier_pack_quantity"] = final_match["supplier_pack"]
            row_base["amazon_asin"] = final_match["asin"]
            row_base["amazon_title"] = final_match["amazon_title"]
            row_base["amazon_pack_quantity"] = final_match["amazon_pack"]
            row_base["barcode_match_status"] = match_status_desc
            row_base["match_status"] = "MATCHED"
            
            if final_match["is_pack_match"]:
                row_base["pack_quantity_status"] = "MATCH"
            elif final_match["is_mismatch"]:
                row_base["pack_quantity_status"] = "MISMATCH"
                
            # Pricing
            offer_res = get_item_offers_batch([final_match["asin"]])
            if offer_res and offer_res[0].get("status", {}).get("statusCode") == 200:
                p_data = parse_pricing_data(offer_res[0].get("body", {}))
                amz_price = p_data.get("featured_offer_price") or p_data.get("lowest_new_landed_price")
                row_base["amazon_price"] = amz_price
                
                if amz_price and row_base["base_unit_cost_inc_vat"]:
                    # adjust cost by pack carpan
                    total_cost = row_base["base_unit_cost_inc_vat"] * final_match["supplier_pack"]
                    row_base["calculated_supplier_cost"] = total_cost
                    
                    # Outlier Check (Anomaly Detection)
                    ratio = float(amz_price) / total_cost
                    if ratio > 4.0:
                        row_base["match_confidence"] = "REVIEW_REQUIRED (Outlier >4x)"
                        metric_review_required += 1
                    else:
                        row_base["match_confidence"] = "HIGH"
                        
                    # Fee & Profit
                    if row_base["pack_quantity_status"] != "MISMATCH" and "REVIEW_REQUIRED" not in row_base["match_confidence"]:
                        try:
                            fee_est = get_fee_estimate(final_match["asin"], amz_price)
                            row_base["amazon_fee"] = fee_est
                            if fee_est:
                                profit = float(amz_price) - float(fee_est) - total_cost
                                row_base["profit"] = round(profit, 2)
                                row_base["margin_pct"] = round((profit / float(amz_price)) * 100, 2)
                                metric_auto_opportunity += 1
                        except:
                            row_base["amazon_fee"] = "ERROR"
            
        results.append(row_base)
        
    logger.info("Generating Report:")
    logger.info(f"- Multi-barcode products: {metric_multi_barcode_products}")
    logger.info(f"- Total alternative barcodes: {metric_total_alt_barcodes}")
    logger.info(f"- New ambiguities: {metric_new_ambiguity}")
    logger.info(f"- Pack mismatches: {metric_pack_mismatches}")
    logger.info(f"- Review required (Outliers): {metric_review_required}")
    logger.info(f"- Auto opportunities: {metric_auto_opportunity}")
    
    with open(OUTPUT_CSV, "w", encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=list(results[0].keys()), extrasaction='ignore')
        writer.writeheader()
        writer.writerows(results)

if __name__ == "__main__":
    asyncio.run(run_multibarcode_pilot())
