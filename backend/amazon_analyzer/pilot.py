import os
import sys
import csv
import json
import asyncio
import logging
import re
from typing import List, Dict, Any, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from amazon_analyzer.normalizer import normalize_identifier
from amazon_analyzer.catalog import search_catalog_items_batch
from amazon_analyzer.pricing import get_item_offers_batch, get_item_offers, parse_pricing_data
from amazon_analyzer.fees import get_fee_estimate
from amazon_analyzer.profit import calculate_profitability

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

CSV_PATH = r"C:\Users\kiyar\Desktop\iş kültür scrapping\outputs\guncel_stok_2026_09_30.csv"
CHECKPOINT_FILE = "amazon_analysis_checkpoint.json"
OUTPUT_CSV = "amazon_analysis_pilot.csv"

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

def load_checkpoint() -> Dict[str, Any]:
    if os.path.exists(CHECKPOINT_FILE):
        with open(CHECKPOINT_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"processed_ids": [], "results": []}

def save_checkpoint(data: Dict[str, Any]):
    temp_file = f"{CHECKPOINT_FILE}.tmp"
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(temp_file, CHECKPOINT_FILE)

def read_supplier_csv(limit: int = 100) -> List[Dict[str, Any]]:
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
                if len(products) >= limit:
                    break
    return products

def export_to_csv(results: List[Dict[str, Any]]):
    if not results: return
    keys = [
        "supplier_product_id", "supplier_code", "supplier_title", "brand", "category",
        "identifier_original", "identifier_normalized", "identifier_type",
        "supplier_stock", "supplier_list_price", "supplier_cost",
        "match_status", "asin", "amazon_title", "amazon_brand", "amazon_image", "amazon_sales_rank",
        "pack_quantity_supplier", "pack_quantity_amazon", "pack_quantity_status",
        "lowest_new_landed_price", "featured_offer_price", "lowest_fba_price", "lowest_mfn_price", "offer_count",
        "fee_estimate_price_basis", "amazon_fee_estimate",
        "estimated_contribution_profit", "estimated_contribution_margin_pct", "cost_completeness",
        "analysis_status", "analysis_error"
    ]
    with open(OUTPUT_CSV, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=keys, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(results)

async def run_pilot():
    logger.info("🚀 Starting Amazon Analyzer Pilot (CSV Mode)...")
    checkpoint = load_checkpoint()
    processed_ids = set(checkpoint["processed_ids"])
    results = checkpoint["results"]
    
    products = read_supplier_csv(100)
    logger.info(f"📦 Selected {len(products)} supplier items for pilot.")
    
    stats = {
        "total": len(products),
        "processed": len(processed_ids),
        "matched": 0,
        "not_found": 0,
        "ambiguous": 0,
        "pricing_checked": 0,
        "pricing_batch_requests": 0,
        "single_pricing_fallback_requests": 0,
        "fees_checked": 0
    }
    
    batch_size = 20
    for i in range(0, len(products), batch_size):
        batch = products[i:i+batch_size]
        valid_items = []
        
        for prod in batch:
            pid = prod["id"]
            if pid in processed_ids: continue
                
            orig_barcode = prod["barkod"]
            norm_barcode, id_type, is_valid = normalize_identifier(orig_barcode)
            list_price = float(prod["liste_fiyat"]) if prod.get("liste_fiyat") else None
            
            result_row = {
                "supplier_product_id": pid,
                "supplier_code": prod.get("kod"),
                "supplier_title": prod.get("ad"),
                "brand": prod.get("marka"),
                "category": prod.get("kategori"),
                "identifier_original": orig_barcode,
                "identifier_normalized": norm_barcode,
                "identifier_type": id_type,
                "supplier_stock": int(prod["stok"]),
                "supplier_list_price": list_price,
                "supplier_cost": None,
                "match_status": "PENDING",
                "analysis_status": "PENDING",
                "analysis_error": None,
                "pack_quantity_supplier": extract_pack_quantity(prod.get("ad")),
                "pack_quantity_amazon": None,
                "pack_quantity_status": "UNKNOWN"
            }
            
            if not is_valid:
                result_row["match_status"] = "INVALID_IDENTIFIER"
                result_row["analysis_status"] = "INVALID_IDENTIFIER"
                results.append(result_row)
                processed_ids.add(pid)
            else:
                valid_items.append((result_row, prod))
                
        if not valid_items: continue
            
        items_by_type = {}
        for row, prod in valid_items:
            typ = row["identifier_type"]
            items_by_type.setdefault(typ, []).append((row, prod))
            
        for typ, type_group in items_by_type.items():
            identifiers = [r["identifier_normalized"] for r, _ in type_group]
            
            try:
                catalog_matches = search_catalog_items_batch(identifiers, typ)
                
                matched_rows = []
                for result_row, prod in type_group:
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
                        stats["not_found"] += 1
                        result_row["match_status"] = "NOT_FOUND"
                        result_row["analysis_status"] = "NOT_FOUND"
                    elif len(matched_items) > 1:
                        stats["ambiguous"] += 1
                        result_row["match_status"] = "AMBIGUOUS"
                        result_row["analysis_status"] = "AMBIGUOUS"
                    else:
                        stats["matched"] += 1
                        result_row["match_status"] = "MATCHED"
                        
                        item = matched_items[0]
                        asin = item.get("asin")
                        result_row["asin"] = asin
                        
                        summaries = item.get("summaries", [])
                        if summaries:
                            result_row["amazon_title"] = summaries[0].get("itemName")
                            result_row["amazon_brand"] = summaries[0].get("brand")
                            result_row["pack_quantity_amazon"] = extract_pack_quantity(result_row["amazon_title"])
                            
                            # Determine mismatch
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

                # Process Pricing in Batch
                if matched_rows:
                    asins = [r["asin"] for r in matched_rows]
                    logger.info(f"💰 Fetching Pricing Batch for {len(asins)} ASINs...")
                    stats["pricing_batch_requests"] += 1
                    
                    batch_responses = get_item_offers_batch(asins)
                    
                    for r_row in matched_rows:
                        stats["pricing_checked"] += 1
                        asin = r_row["asin"]
                        
                        # Find corresponding response
                        offer_res = None
                        for res in batch_responses:
                            body = res.get("body", {})
                            req_asin = body.get("payload", {}).get("ASIN")
                            if req_asin == asin:
                                offer_res = res
                                break
                                
                        if offer_res and offer_res.get("status", {}).get("statusCode") == 200:
                            pricing_data = parse_pricing_data(offer_res.get("body", {}))
                            r_row.update(pricing_data)
                        else:
                            # Single fallback if batch failed for this item (or not found in batch)
                            logger.info(f"Fallback to single pricing for ASIN: {asin}")
                            stats["single_pricing_fallback_requests"] += 1
                            try:
                                single_resp = get_item_offers(asin)
                                pricing_data = parse_pricing_data(single_resp)
                                r_row.update(pricing_data)
                            except Exception as e:
                                r_row["analysis_error"] = f"Pricing Fallback Error: {e}"
                        
                        candidate_price = r_row.get("featured_offer_price") or r_row.get("lowest_new_landed_price")
                        if candidate_price:
                            r_row["fee_estimate_price_basis"] = candidate_price
                            r_row["analysis_status"] = "PRICED"
                            
                            if stats["fees_checked"] < 5:
                                stats["fees_checked"] += 1
                                try:
                                    fee_est = get_fee_estimate(asin, candidate_price)
                                    r_row["amazon_fee_estimate"] = fee_est
                                    r_row["analysis_status"] = "FEE_PENDING" if fee_est is None else "ANALYZED"
                                except Exception as e:
                                    r_row["analysis_error"] = f"Fees Error: {e}"
                                    r_row["analysis_status"] = "FEE_BLOCKED"
                        else:
                            r_row["analysis_status"] = "NO_OFFERS"

            except Exception as e:
                logger.error(f"❌ API Error for batch {typ}: {str(e)}")
                for result_row, _ in type_group:
                    result_row["match_status"] = "API_ERROR"
                    result_row["analysis_status"] = "API_ERROR"
                    result_row["analysis_error"] = str(e)
                    
            for result_row, _ in type_group:
                results.append(result_row)
                processed_ids.add(result_row["supplier_product_id"])
                
            save_checkpoint({"processed_ids": list(processed_ids), "results": results})
            
    export_to_csv(results)
    
    # Print report dict to stdout so we can capture it easily
    print(json.dumps(stats))

if __name__ == "__main__":
    asyncio.run(run_pilot())
