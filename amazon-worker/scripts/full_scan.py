import csv
import json
import logging
import re
import time
import sys
import os
import requests
from typing import Dict, Any, List, Set

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from amazon_analyzer.normalizer import normalize_identifier
from amazon_analyzer.client import call_sp_api
from amazon_analyzer.auth import MARKETPLACE_ID

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s', datefmt='%H:%M:%S')
logger = logging.getLogger(__name__)

# File Paths
SUPPLIER_CSV = r"C:\Users\kiyar\Desktop\iş kültür scrapping\outputs\guncel_stok_2026_09_30.csv"
ENRICHED_CSV = r"C:\Users\kiyar\Desktop\adana-ozel-ders\backend\scripts\yildirim_multibarcode_enriched_2026_09_30.csv"
HAR_PATH = r"C:\Users\kiyar\Desktop\b2b.yildirimdagitim.com_Archive [26-10-01 03-03-55].har"

# Checkpoints
CHK_CATALOG = "scan_checkpoint_catalog.json"
CHK_PRICING = "scan_checkpoint_pricing.json"
CHK_FEES = "scan_checkpoint_fees.json"
CHK_COST = "scan_checkpoint_cost.json"
CHK_FINAL = "scan_checkpoint_final.json"

def chunk_list(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]

def load_json(path):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def extract_pack_quantity(title: str) -> int:
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

def extract_token_from_har(har_path: str) -> str:
    with open(har_path, 'r', encoding='utf-8') as f:
        har_data = json.load(f)
    for entry in har_data['log']['entries']:
        req = entry['request']
        for header in req['headers']:
            if header['name'].lower() == 'authorization' and 'Bearer' in header['value']:
                return header['value'].replace('Bearer ', '').strip()
    return None

def run_full_scan():
    # Load Input Data
    base_products = {}
    with open(SUPPLIER_CSV, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f, delimiter=";"):
            pid = str(row.get("id", "")).strip()
            if pid and pid.isdigit():
                min_order = int(row.get("min_siparis", 1) or 1)
                base_products[pid] = {"min_order": min_order}

    enriched = {}
    with open(ENRICHED_CSV, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            pid = row["supplier_product_id"]
            if pid in base_products:
                enriched[pid] = row
                enriched[pid]["min_order"] = base_products[pid]["min_order"]

    logger.info(f"Loaded {len(enriched)} enriched products for scanning.")
    
    # ---------------------------------------------------------------------
    # STAGE 1: CATALOG MATCHING
    # ---------------------------------------------------------------------
    logger.info("=== STAGE 1: CATALOG ===")
    catalog_chk = load_json(CHK_CATALOG)
    
    # Identify unique identifiers to search
    barcodes_to_search = {} # type -> set(identifiers)
    barcode_to_products = {} # barcode -> list of pids
    
    for pid, data in enriched.items():
        if pid in catalog_chk:
            continue
            
        all_barcodes = data.get("all_barcodes", "").split("|")
        all_multipliers = data.get("all_multipliers", "").split("|")
        
        for b, m in zip(all_barcodes, all_multipliers):
            if not b: continue
            norm_b, b_type, is_valid = normalize_identifier(b)
            if is_valid:
                barcodes_to_search.setdefault(b_type, set()).add(norm_b)
                barcode_to_products.setdefault(norm_b, []).append((pid, int(m)))

    amazon_items_found = {} # barcode -> list of amazon items
    total_to_search = sum(len(s) for s in barcodes_to_search.values())
    
    if total_to_search > 0:
        logger.info(f"Searching {total_to_search} new unique barcodes in Catalog...")
        searched = 0
        for b_type, b_set in barcodes_to_search.items():
            b_list = list(b_set)
            for batch in chunk_list(b_list, 20):
                searched += len(batch)
                try:
                    params = {
                        "identifiers": ",".join(batch),
                        "identifiersType": b_type,
                        "marketplaceIds": MARKETPLACE_ID,
                        "includedData": "summaries,identifiers"
                    }
                    res = call_sp_api("GET", "/catalog/2022-04-01/items", params=params)
                    for item in res.get("items", []):
                        for ident in item.get("identifiers", []):
                            for id_obj in ident.get("identifiers", []):
                                if id_obj.get("identifierType") == b_type:
                                    val = id_obj.get("identifier")
                                    amazon_items_found.setdefault(val, []).append(item)
                except Exception as e:
                    logger.error(f"Catalog API error on chunk: {e}")
                logger.info(f"Catalog Progress: {searched}/{total_to_search} identifiers")
                
        # Resolve products
        for pid, data in enriched.items():
            if pid in catalog_chk: continue
            
            p_barcodes = data.get("all_barcodes", "").split("|")
            p_multis = data.get("all_multipliers", "").split("|")
            primary = data.get("primary_barcode", "")
            
            candidates = []
            for b, m in zip(p_barcodes, p_multis):
                norm_b, _, valid = normalize_identifier(b)
                if valid and norm_b in amazon_items_found:
                    for amz_item in amazon_items_found[norm_b]:
                        title = amz_item.get("summaries", [{}])[0].get("itemName", "")
                        asin = amz_item.get("asin")
                        amz_pack = extract_pack_quantity(title)
                        candidates.append({
                            "barcode": norm_b,
                            "carpan": int(m),
                            "asin": asin,
                            "amazon_title": title,
                            "amazon_pack": amz_pack,
                            "is_primary": norm_b == primary
                        })
            
            best_match = None
            match_status = "NOT_FOUND"
            pack_status = "UNKNOWN"
            ambiguous = False
            
            if candidates:
                exact_packs = [c for c in candidates if c["amazon_pack"] == c["carpan"]]
                unknown_packs = [c for c in candidates if c["amazon_pack"] is None]
                mismatches = [c for c in candidates if c["amazon_pack"] is not None and c["amazon_pack"] != c["carpan"]]
                
                if exact_packs:
                    if len(set(c["asin"] for c in exact_packs)) > 1:
                        ambiguous = True
                    else:
                        best_match = exact_packs[0]
                        pack_status = "MATCH"
                elif unknown_packs:
                    if len(set(c["asin"] for c in unknown_packs)) > 1:
                        ambiguous = True
                    else:
                        best_match = unknown_packs[0]
                        pack_status = "UNKNOWN"
                elif mismatches:
                    if len(set(c["asin"] for c in mismatches)) > 1:
                        ambiguous = True
                    else:
                        best_match = mismatches[0]
                        pack_status = "MISMATCH"
                        
                if ambiguous:
                    match_status = "MULTI_BARCODE_AMBIGUOUS"
                elif best_match:
                    match_status = "MATCHED"

            catalog_chk[pid] = {
                "supplier_product_id": pid,
                "supplier_title": data["supplier_title"],
                "supplier_code": data["supplier_code"],
                "primary_barcode": data["primary_barcode"],
                "min_order": data["min_order"],
                "match_status": match_status,
                "pack_quantity_status": pack_status,
                "amazon_asin": best_match["asin"] if best_match else None,
                "amazon_title": best_match["amazon_title"] if best_match else None,
                "selected_supplier_barcode": best_match["barcode"] if best_match else None,
                "supplier_pack_quantity": best_match["carpan"] if best_match else None,
                "is_primary_barcode": best_match["is_primary"] if best_match else None,
                "classification": "REJECT" if match_status != "MATCHED" or pack_status == "MISMATCH" else "PENDING"
            }
        save_json(CHK_CATALOG, catalog_chk)
    
    c_matched = sum(1 for c in catalog_chk.values() if c["match_status"] == "MATCHED")
    c_ambig = sum(1 for c in catalog_chk.values() if c["match_status"] == "MULTI_BARCODE_AMBIGUOUS")
    logger.info(f"Catalog Stage Complete. Matched: {c_matched}, Ambiguous: {c_ambig}")

    # ---------------------------------------------------------------------
    # STAGE 2: PRICING
    # ---------------------------------------------------------------------
    logger.info("=== STAGE 2: PRICING ===")
    pricing_chk = load_json(CHK_PRICING)
    
    asins_to_price = set()
    for pid, c in catalog_chk.items():
        if c["match_status"] == "MATCHED" and c["amazon_asin"] not in pricing_chk:
            asins_to_price.add(c["amazon_asin"])
            
    asins_to_price = list(asins_to_price)
    
    if asins_to_price:
        logger.info(f"Fetching pricing for {len(asins_to_price)} ASINs in {len(list(chunk_list(asins_to_price, 20)))} logical batches...")
        
        stats_pricing_logical_batches = 0
        stats_pricing_http_attempts = 0
        
        for batch in chunk_list(asins_to_price, 20):
            stats_pricing_logical_batches += 1
            requests_list = []
            for asin in batch:
                requests_list.append({
                    "uri": f"/products/pricing/v0/items/{asin}/offers",
                    "method": "GET",
                    "MarketplaceId": MARKETPLACE_ID,
                    "ItemCondition": "New"
                })
                
            try:
                stats_pricing_http_attempts += 1
                res = call_sp_api("POST", "/batches/products/pricing/v0/itemOffers", data={"requests": requests_list})
                for r in res.get("responses", []):
                    status = r.get("status", {}).get("statusCode")
                    body = r.get("body", {})
                    asin = body.get("payload", {}).get("ASIN")
                    if status == 200 and asin:
                        summary = body.get("payload", {}).get("Summary", {})
                        lp = summary.get("LowestPrices", [])
                        price = lp[0].get("LandedPrice", {}).get("Amount") if lp else None
                        buybox = summary.get("BuyBoxPrices", [])
                        bb_price = buybox[0].get("LandedPrice", {}).get("Amount") if buybox else None
                        
                        final_price = bb_price or price
                        pricing_chk[asin] = {"amazon_price": final_price, "status": "SUCCESS"}
                    elif asin:
                        pricing_chk[asin] = {"amazon_price": None, "status": "NO_OFFER" if status == 200 else "ERROR"}
            except Exception as e:
                logger.error(f"Pricing batch error: {e}")
                for asin in batch:
                    pricing_chk[asin] = {"amazon_price": None, "status": "API_INCOMPLETE"}
                    
            logger.info(f"Pricing Progress: {min(stats_pricing_logical_batches * 20, len(asins_to_price))}/{len(asins_to_price)} ASINs")
            save_json(CHK_PRICING, pricing_chk)

    # ---------------------------------------------------------------------
    # STAGE 3: FEES
    # ---------------------------------------------------------------------
    logger.info("=== STAGE 3: FEES ===")
    fees_chk = load_json(CHK_FEES)
    
    fee_requests = [] # dict of asin -> price
    for pid, c in catalog_chk.items():
        asin = c.get("amazon_asin")
        if not asin: continue
        p_info = pricing_chk.get(asin, {})
        if p_info.get("amazon_price") and asin not in fees_chk:
            fee_requests.append({"asin": asin, "price": p_info["amazon_price"]})
            
    # Deduplicate ASINs for fees
    unique_fee_reqs = {r["asin"]: r["price"] for r in fee_requests}
    req_items = list(unique_fee_reqs.items())
    
    if req_items:
        logger.info(f"Fetching fees for {len(req_items)} ASINs in {len(list(chunk_list(req_items, 20)))} batches...")
        
        for batch in chunk_list(req_items, 20):
            payload = []
            for asin, price in batch:
                payload.append({
                    "FeesEstimateRequest": {
                        "MarketplaceId": MARKETPLACE_ID,
                        "IsAmazonFulfilled": True,
                        "PriceToEstimateFees": {"ListingPrice": {"CurrencyCode": "TRY", "Amount": price}},
                        "Identifier": asin
                    },
                    "IdType": "ASIN",
                    "IdValue": asin
                })
            try:
                res = call_sp_api("POST", "/products/fees/v0/feesEstimate", data=payload)
                for item in res:
                    status = item.get("Status")
                    asin = item.get("FeesEstimateIdentifier", {}).get("IdValue")
                    if status == "Success":
                        fee = item.get("FeesEstimate", {}).get("TotalFeesEstimate", {}).get("Amount")
                        fees_chk[asin] = {"amazon_fee": fee, "status": "SUCCESS"}
                    else:
                        fees_chk[asin] = {"amazon_fee": None, "status": "ERROR"}
            except Exception as e:
                logger.error(f"Fee batch error: {e}")
                for asin, _ in batch:
                    fees_chk[asin] = {"amazon_fee": None, "status": "API_INCOMPLETE"}
                    
            save_json(CHK_FEES, fees_chk)

    # ---------------------------------------------------------------------
    # STAGE 4: LIVE COSTS
    # ---------------------------------------------------------------------
    logger.info("=== STAGE 4: LIVE COST ===")
    cost_chk = load_json(CHK_COST)
    
    # We only need live cost for products that have an Amazon price (to save B2B API load)
    # But let's fetch for all MATCHED products to be thorough.
    stok_ids_to_fetch = set()
    for pid, c in catalog_chk.items():
        if c["match_status"] == "MATCHED" and pid not in cost_chk:
            stok_ids_to_fetch.add(int(pid))
            
    stok_ids_to_fetch = list(stok_ids_to_fetch)
    if stok_ids_to_fetch:
        token = extract_token_from_har(HAR_PATH)
        if not token:
            logger.error("HAR Token not found. Cannot fetch live prices.")
        else:
            logger.info(f"Fetching live Yildirim prices for {len(stok_ids_to_fetch)} matched products...")
            headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
            url = "https://b2b.yildirimdagitim.com/api/vitrin/fiyat"
            
            for batch in chunk_list(stok_ids_to_fetch, 100):
                try:
                    payload = {"stokIds": batch, "kirilim": True}
                    r = requests.post(url, json=payload, headers=headers, timeout=30)
                    if r.status_code == 200:
                        data = r.json()
                        fiyatlar = data.get("fiyatlar", {})
                        kirilim = data.get("kirilim", {})
                        
                        for pid in batch:
                            f_data = fiyatlar.get(str(pid)) or fiyatlar.get(pid, {})
                            k_data = kirilim.get(str(pid)) or kirilim.get(pid, [])
                            sup_cost = None
                            if f_data:
                                pesin_k = next((k for k in k_data if k.get("altHesapId") == 2), None)
                                if pesin_k:
                                    net_ex_vat = float(pesin_k.get("net", 0))
                                    vat_rate = float(f_data.get("kdv", 0))
                                    sup_cost = round(net_ex_vat * (1 + vat_rate / 100), 2)
                                    
                            cost_chk[str(pid)] = {
                                "supplier_cost_inc_vat": sup_cost,
                                "supplier_cost_confidence": "VERIFIED_LIVE" if sup_cost else "UNVERIFIED"
                            }
                    else:
                        logger.error(f"B2B Pricing error HTTP {r.status_code}: {r.text}")
                        for pid in batch:
                            cost_chk[str(pid)] = {"supplier_cost_inc_vat": None, "supplier_cost_confidence": "API_INCOMPLETE"}
                except Exception as e:
                    logger.error(f"B2B Pricing error: {e}")
                    for pid in batch:
                        cost_chk[str(pid)] = {"supplier_cost_inc_vat": None, "supplier_cost_confidence": "API_INCOMPLETE"}
                
                save_json(CHK_COST, cost_chk)
                
    # ---------------------------------------------------------------------
    # STAGE 5: CLASSIFICATION
    # ---------------------------------------------------------------------
    logger.info("=== STAGE 5: FINAL CLASSIFICATION ===")
    final_output = []
    
    stats = {
        "AUTO_OPPORTUNITY": 0,
        "REVIEW_REQUIRED": 0,
        "REJECT": 0,
        "API_INCOMPLETE": 0,
        "total_supplier_products": len(enriched),
        "total_amazon_matched": c_matched,
        "total_pack_mismatch": 0,
        "total_ambiguous": c_ambig,
        "total_offers_found": 0,
        "total_fees_success": 0
    }
    
    for pid, c in catalog_chk.items():
        row = c.copy()
        asin = row.get("amazon_asin")
        
        p_info = pricing_chk.get(asin, {}) if asin else {}
        f_info = fees_chk.get(asin, {}) if asin else {}
        cost_info = cost_chk.get(pid, {})
        
        row["amazon_price"] = p_info.get("amazon_price")
        row["amazon_fee"] = f_info.get("amazon_fee")
        row["supplier_cost_inc_vat"] = cost_info.get("supplier_cost_inc_vat")
        row["supplier_cost_confidence"] = cost_info.get("supplier_cost_confidence", "UNVERIFIED")
        row["margin_anomaly_status"] = "OK"
        row["estimated_contribution_before_shipping"] = None
        row["margin_pct"] = None
        row["minimum_purchase_cash_required"] = None
        
        # Identity Confidence
        if row["match_status"] == "MATCHED":
            if row["pack_quantity_status"] == "MATCH":
                row["barcode_match_confidence"] = "HIGH" if row.get("is_primary_barcode") else "MEDIUM_HIGH"
            elif row["pack_quantity_status"] == "MISMATCH":
                row["barcode_match_confidence"] = "REJECT"
                stats["total_pack_mismatch"] += 1
            else:
                row["barcode_match_confidence"] = "MEDIUM" if row.get("is_primary_barcode") else "LOW"
        else:
            row["barcode_match_confidence"] = "REJECT"
            
        if row["amazon_price"]:
            stats["total_offers_found"] += 1
            
        if row["amazon_fee"]:
            stats["total_fees_success"] += 1
            
        # Math
        if row["amazon_price"] and row["supplier_cost_inc_vat"] and row["supplier_pack_quantity"]:
            total_cost = row["supplier_cost_inc_vat"] * int(row["supplier_pack_quantity"])
            row["calculated_supplier_cost"] = total_cost
            row["minimum_purchase_cash_required"] = round(row["supplier_cost_inc_vat"] * row["min_order"], 2)
            
            if float(row["amazon_price"]) / total_cost > 4.0:
                row["margin_anomaly_status"] = "HIGH_MARGIN_REVIEW"
                
            if row["amazon_fee"]:
                profit = float(row["amazon_price"]) - float(row["amazon_fee"]) - total_cost
                row["estimated_contribution_before_shipping"] = round(profit, 2)
                row["margin_pct"] = round((profit / float(row["amazon_price"])) * 100, 2)
        
        # Classification Logic
        is_api_incomplete = (
            p_info.get("status") == "API_INCOMPLETE" or 
            f_info.get("status") == "API_INCOMPLETE" or
            cost_info.get("supplier_cost_confidence") == "API_INCOMPLETE"
        )
        
        is_reject = (
            row["match_status"] != "MATCHED" or 
            row["pack_quantity_status"] == "MISMATCH" or
            p_info.get("status") in ["ERROR", "NO_OFFER"] or
            f_info.get("status") == "ERROR" or
            row["supplier_cost_confidence"] == "UNVERIFIED"
        )
        
        if is_api_incomplete:
            row["final_opportunity_status"] = "API_INCOMPLETE"
        elif is_reject:
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
                
        stats[row["final_opportunity_status"]] += 1
        final_output.append(row)
        
    # Write CSVs
    def write_csv(filename, rows):
        if not rows: return
        # Ensure all dicts have the exact same keys
        keys = list(rows[0].keys())
        with open(filename, "w", encoding='utf-8-sig', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=keys, extrasaction='ignore')
            writer.writeheader()
            writer.writerows(rows)
            
    auto_opps = [r for r in final_output if r["final_opportunity_status"] == "AUTO_OPPORTUNITY"]
    reviews = [r for r in final_output if r["final_opportunity_status"] == "REVIEW_REQUIRED"]
    rejects = [r for r in final_output if r["final_opportunity_status"] == "REJECT"]
    incompletes = [r for r in final_output if r["final_opportunity_status"] == "API_INCOMPLETE"]
    
    # Sort opportunities by highest margin/contribution
    auto_opps.sort(key=lambda x: x.get("estimated_contribution_before_shipping") or -999, reverse=True)
    
    write_csv("amazon_opportunities.csv", auto_opps)
    write_csv("amazon_review_required.csv", reviews)
    write_csv("amazon_rejected.csv", rejects)
    write_csv("amazon_api_incomplete.csv", incompletes)
    write_csv("amazon_full_analysis.csv", final_output)
    
    print("\n" + "="*60)
    print("FULL AMAZON SCAN REPORT")
    print("="*60)
    print(f"Total Supplier Products: {stats['total_supplier_products']}")
    print(f"Amazon Matched Products: {stats['total_amazon_matched']}")
    print(f"Total Unique Offers Found: {stats['total_offers_found']}")
    print(f"Total Fee Calls Successful: {stats['total_fees_success']}")
    print(f"Pack Mismatches Eliminated: {stats['total_pack_mismatch']}")
    print(f"Multi-Barcode Ambiguous: {stats['total_ambiguous']}")
    print("-" * 60)
    print(f"AUTO_OPPORTUNITY: {stats['AUTO_OPPORTUNITY']}")
    print(f"REVIEW_REQUIRED: {stats['REVIEW_REQUIRED']}")
    print(f"REJECT: {stats['REJECT']}")
    print(f"API_INCOMPLETE: {stats['API_INCOMPLETE']}")
    print("="*60)
    
    if stats['API_INCOMPLETE'] > 0:
        print("\nWARNING: API_INCOMPLETE > 0. Some items exhausted rate limits or encountered 5xx errors.")
        print("Run the script again to resume from checkpoints and complete these items.")
        
    if auto_opps:
        print("\nTOP 20 AUTO_OPPORTUNITIES:")
        for r in auto_opps[:20]:
            print(f"- {r['supplier_title'][:40]} | ASIN: {r['amazon_asin']} | Cost: {r['calculated_supplier_cost']} | Price: {r['amazon_price']} | Fee: {r['amazon_fee']} | Profit: {r['estimated_contribution_before_shipping']} TL | Margin: {r['margin_pct']}% | Min Cash: {r['minimum_purchase_cash_required']}")

    print(f"\nFiles generated:")
    print("- amazon_opportunities.csv")
    print("- amazon_review_required.csv")
    print("- amazon_rejected.csv")
    print("- amazon_api_incomplete.csv")
    print("- amazon_full_analysis.csv")

if __name__ == "__main__":
    run_full_scan()
