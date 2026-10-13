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

async def fetch_product_details_concurrently(stok_ids: List[int], concurrency: int = 10) -> Dict[int, Dict]:
    sem = asyncio.Semaphore(concurrency)
    results = {}
    
    async def fetch(client, pid):
        url = f"https://b2b.yildirimdagitim.com/api/vitrin/urun/{pid}"
        headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.0"}
        async with sem:
            try:
                r = await client.get(url, headers=headers)
                if r.status_code == 200:
                    results[pid] = r.json()
            except: pass

    async with httpx.AsyncClient(timeout=30) as client:
        tasks = [fetch(client, pid) for pid in stok_ids]
        await asyncio.gather(*tasks)
        
    return results

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

def chunk_list(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]

async def run_final_rules_pilot():
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
    
    # 1. Fetch B2B Prices
    b2b_price_data = await fetch_b2b_prices(stok_ids, token) if token else {}
    fiyatlar = b2b_price_data.get('fiyatlar', {})
    kirilim = b2b_price_data.get('kirilim', {})
    
    # 2. Fetch B2B Details concurrently
    logger.info("Fetching B2B product details concurrently...")
    b2b_details = await fetch_product_details_concurrently(stok_ids, concurrency=20)
    
    results_map = {}
    
    all_candidates = []
    
    for prod in products:
        pid = int(prod['id'])
        
        sup_cost_inc_vat = None
        f_data = fiyatlar.get(str(pid)) or fiyatlar.get(pid, {})
        k_data = kirilim.get(str(pid)) or kirilim.get(pid, [])
        if f_data:
            pesin_k = next((k for k in k_data if k.get('altHesapId') == 2), None)
            if pesin_k:
                net_ex_vat = float(pesin_k.get('net', 0))
                vat_rate = float(f_data.get('kdv', 0))
                sup_cost_inc_vat = round(net_ex_vat * (1 + vat_rate / 100), 2)

        p_details = b2b_details.get(pid, {})
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
                
        seen = set()
        uniq_candidates = []
        for c in candidates:
            if c["barcode"] not in seen:
                seen.add(c["barcode"])
                uniq_candidates.append(c)
                
        for c in uniq_candidates:
            all_candidates.append({"pid": pid, "candidate": c})
                
        primary_b = prod.get("barkod", "").strip()
        norm_primary, _, _ = normalize_identifier(primary_b)
        
        results_map[pid] = {
            "supplier_product_id": pid,
            "supplier_title": prod.get("ad"),
            "primary_supplier_barcode": norm_primary or primary_b,
            "all_supplier_barcodes": "|".join([c["barcode"] for c in uniq_candidates]),
            "base_unit_cost_inc_vat": sup_cost_inc_vat,
            "match_status": "NOT_FOUND",
            "pack_quantity_status": "UNKNOWN",
            "barcode_match_confidence": "UNKNOWN",
            "margin_anomaly_status": "OK",
            "supplier_cost_confidence": "VERIFIED_LIVE" if sup_cost_inc_vat else "UNVERIFIED",
            "amazon_price": None,
            "amazon_fee": None,
            "profit": None,
            "margin_pct": None,
            "final_opportunity_status": "REJECT",
            "candidates_found": uniq_candidates,
            "amazon_items_found": []
        }
        
    # 3. Batched Amazon Catalog Search
    logger.info(f"Searching Amazon Catalog for {len(all_candidates)} barcodes in batches...")
    
    # Group candidates by identifier type to respect batch API
    candidates_by_type = {}
    for c in all_candidates:
        typ = c["candidate"]["type"]
        candidates_by_type.setdefault(typ, []).append(c)
        
    for typ, c_list in candidates_by_type.items():
        for batch in chunk_list(c_list, 20):
            identifiers = [c["candidate"]["barcode"] for c in batch]
            try:
                cat_res = search_catalog_items_batch(identifiers, typ)
                for item in cat_res:
                    # Match back to candidates
                    for ident in item.get("identifiers", []):
                        for id_obj in ident.get("identifiers", []):
                            if id_obj.get("identifierType") == typ:
                                amz_val = id_obj.get("identifier")
                                for c in batch:
                                    if c["candidate"]["barcode"] == amz_val:
                                        results_map[c["pid"]]["amazon_items_found"].append({
                                            "amazon_item": item,
                                            "supplier_candidate": c["candidate"]
                                        })
            except Exception as e:
                logger.error(f"Catalog batch error: {e}")

    # Process Matches
    asins_to_price = set()
    for pid, row in results_map.items():
        if not row["amazon_items_found"]:
            continue
            
        best_matches = []
        for m in row["amazon_items_found"]:
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
            
        pack_matched = [m for m in best_matches if m["is_pack_match"]]
        unknown_pack = [m for m in best_matches if not m["is_pack_match"] and not m["is_mismatch"]]
        mismatched = [m for m in best_matches if m["is_mismatch"]]
        
        final_match = None
        ambiguous = False
        
        if len(pack_matched) == 1:
            final_match = pack_matched[0]
        elif len(pack_matched) > 1:
            ambiguous = True
        elif len(unknown_pack) == 1:
            final_match = unknown_pack[0]
        elif len(unknown_pack) > 1:
            ambiguous = True
        elif len(mismatched) == 1:
            final_match = mismatched[0]
        elif len(mismatched) > 1:
            ambiguous = True
            
        if ambiguous:
            row["match_status"] = "MULTI_BARCODE_AMBIGUOUS"
            row["barcode_match_confidence"] = "LOW"
            continue
            
        if final_match:
            row["selected_supplier_barcode"] = final_match["supplier_barcode"]
            row["supplier_pack_quantity"] = final_match["supplier_pack"]
            row["amazon_asin"] = final_match["asin"]
            row["amazon_title"] = final_match["amazon_title"]
            row["amazon_pack_quantity"] = final_match["amazon_pack"]
            row["match_status"] = "MATCHED"
            
            is_primary = (final_match["supplier_barcode"] == row["primary_supplier_barcode"])
            
            if final_match["is_pack_match"]:
                row["pack_quantity_status"] = "MATCH"
                row["barcode_match_confidence"] = "HIGH" if is_primary else "MEDIUM_HIGH"
            elif final_match["is_mismatch"]:
                row["pack_quantity_status"] = "MISMATCH"
                row["barcode_match_confidence"] = "REJECT"
            else:
                row["pack_quantity_status"] = "UNKNOWN"
                row["barcode_match_confidence"] = "MEDIUM" if is_primary else "LOW"
                
            asins_to_price.add(final_match["asin"])

    # 4. Batched Amazon Pricing Search
    logger.info(f"Fetching pricing for {len(asins_to_price)} ASINs in batches...")
    prices = {}
    for batch in chunk_list(list(asins_to_price), 20):
        try:
            offer_res = get_item_offers_batch(batch)
            for res in offer_res:
                if res.get("status", {}).get("statusCode") == 200:
                    body = res.get("body", {})
                    asin = body.get("payload", {}).get("ASIN")
                    p_data = parse_pricing_data(body)
                    amz_price = p_data.get("featured_offer_price") or p_data.get("lowest_new_landed_price")
                    if asin and amz_price:
                        prices[asin] = amz_price
        except Exception as e:
            logger.error(f"Pricing batch error: {e}")

    # Evaluate Profit & Status
    logger.info("Evaluating final statuses and calculating fees...")
    for pid, row in results_map.items():
        asin = row.get("amazon_asin")
        if asin and asin in prices:
            amz_price = prices[asin]
            row["amazon_price"] = amz_price
            
            if row["base_unit_cost_inc_vat"]:
                total_cost = row["base_unit_cost_inc_vat"] * row.get("supplier_pack_quantity", 1)
                row["calculated_supplier_cost"] = total_cost
                
                ratio = float(amz_price) / total_cost
                if ratio > 4.0:
                    row["margin_anomaly_status"] = "HIGH_MARGIN_REVIEW"
                    
                if row["pack_quantity_status"] != "MISMATCH":
                    try:
                        fee_est = get_fee_estimate(asin, amz_price)
                        row["amazon_fee"] = fee_est
                        if fee_est:
                            profit = float(amz_price) - float(fee_est) - total_cost
                            row["profit"] = round(profit, 2)
                            row["margin_pct"] = round((profit / float(amz_price)) * 100, 2)
                    except:
                        row["amazon_fee"] = "ERROR"

        is_reject = (
            row["match_status"] != "MATCHED" or 
            row["pack_quantity_status"] == "MISMATCH" or
            row["amazon_price"] is None or
            row["amazon_fee"] is None or
            row["amazon_fee"] == "ERROR" or
            row["supplier_cost_confidence"] != "VERIFIED_LIVE"
        )
        
        if is_reject:
            row["final_opportunity_status"] = "REJECT"
        else:
            needs_review = (
                row["pack_quantity_status"] == "UNKNOWN" or
                row["margin_anomaly_status"] == "HIGH_MARGIN_REVIEW" or
                row["barcode_match_confidence"] in ["MEDIUM", "LOW"]
            )
            
            if needs_review:
                row["final_opportunity_status"] = "REVIEW_REQUIRED"
            else:
                row["final_opportunity_status"] = "AUTO_OPPORTUNITY"
                
    # Formatting output and cleaning temp arrays
    output_rows = []
    for pid, row in results_map.items():
        del row["candidates_found"]
        del row["amazon_items_found"]
        output_rows.append(row)
        
    auto_opps = [r for r in output_rows if r["final_opportunity_status"] == "AUTO_OPPORTUNITY"]
    reviews = [r for r in output_rows if r["final_opportunity_status"] == "REVIEW_REQUIRED"]
    rejects = [r for r in output_rows if r["final_opportunity_status"] == "REJECT"]
    
    def write_csv(filename, rows):
        if not rows: return
        with open(filename, "w", encoding='utf-8-sig', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()), extrasaction='ignore')
            writer.writeheader()
            writer.writerows(rows)
            
    write_csv("amazon_opportunities.csv", auto_opps)
    write_csv("amazon_review_required.csv", reviews)
    write_csv("amazon_rejected.csv", rejects)
    
    logger.info(f"AUTO_OPPORTUNITY: {len(auto_opps)}")
    logger.info(f"REVIEW_REQUIRED: {len(reviews)}")
    logger.info(f"REJECT: {len(rejects)}")

if __name__ == "__main__":
    asyncio.run(run_final_rules_pilot())
