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

SUPPLIER_CSV = r"C:\Users\kiyar\Desktop\iş kültür scrapping\outputs\guncel_stok_2026_09_30.csv"
ENRICHED_CSV = r"C:\Users\kiyar\Desktop\adana-ozel-ders\backend\scripts\yildirim_multibarcode_enriched_2026_09_30.csv"
CHK_CATALOG = "scan_checkpoint_catalog.json"
CHK_PRICING = "scan_checkpoint_pricing.json"
CHK_FEES_FBA = "scan_checkpoint_fees.json"
CHK_FEES_MFN = "scan_checkpoint_fees_mfn.json"
CHK_COST = "scan_checkpoint_cost.json"

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
    # Improved regex to prevent false mismatches (like dimensions 10X15)
    m = re.search(r'\b(\d+)\s*(?:[\'’‘`]?\s*[Ll][IİııUÜüü]\b|ADET\b|PAR[ÇC]A\b|PACK\b|PCS\b)', title, re.IGNORECASE)
    if m: return int(m.group(1))
    m_pack = re.search(r'\bPACK\s+OF\s+(\d+)\b', title, re.IGNORECASE)
    if m_pack: return int(m_pack.group(1))
    return None

def run_audit():
    logger.info("Starting Audit & Recalc...")
    
    # 1. Load Data
    enriched = {}
    with open(ENRICHED_CSV, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            enriched[row["supplier_product_id"]] = row
            
    base_min_orders = {}
    with open(SUPPLIER_CSV, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f, delimiter=";"):
            pid = str(row.get("id", "")).strip()
            if pid: base_min_orders[pid] = int(row.get("min_siparis", 1) or 1)

    catalog_chk = load_json(CHK_CATALOG)
    pricing_chk = load_json(CHK_PRICING)
    fees_fba = load_json(CHK_FEES_FBA)
    fees_mfn = load_json(CHK_FEES_MFN)
    cost_chk = load_json(CHK_COST)

    # 2. Re-resolve Ambiguous & Mismatched Products
    # We will fetch missing catalog data for AMBIGUOUS items.
    ambiguous_pids = [pid for pid, c in catalog_chk.items() if c.get("match_status") == "MULTI_BARCODE_AMBIGUOUS"]
    
    if ambiguous_pids:
        logger.info(f"Re-fetching Catalog for {len(ambiguous_pids)} ambiguous items...")
        barcodes_to_search = {}
        for pid in ambiguous_pids:
            enr = enriched[pid]
            all_barcodes = enr.get("all_barcodes", "").split("|")
            for b in all_barcodes:
                norm_b, b_type, valid = normalize_identifier(b)
                if valid:
                    barcodes_to_search.setdefault(b_type, set()).add(norm_b)
                    
        amazon_items_found = {}
        for b_type, b_set in barcodes_to_search.items():
            b_list = list(b_set)
            for batch in chunk_list(b_list, 20):
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
                    logger.error(f"Catalog re-fetch error: {e}")
                    
        # Re-evaluate ambiguous items with new independent candidate logic
        for pid in ambiguous_pids:
            enr = enriched[pid]
            p_barcodes = enr.get("all_barcodes", "").split("|")
            p_multis = enr.get("all_multipliers", "").split("|")
            primary = enr.get("primary_barcode", "")
            
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
                        
            # Independent logic: Group by ASIN to avoid duplications, pick the best match for the base product
            best_match = None
            match_status = "NOT_FOUND"
            pack_status = "UNKNOWN"
            
            if candidates:
                exact_packs = [c for c in candidates if c["amazon_pack"] == c["carpan"]]
                unknown_packs = [c for c in candidates if c["amazon_pack"] is None]
                mismatches = [c for c in candidates if c["amazon_pack"] is not None and c["amazon_pack"] != c["carpan"]]
                
                # Pick the first exact pack (prioritize primary)
                if exact_packs:
                    exact_packs.sort(key=lambda x: not x["is_primary"])
                    best_match = exact_packs[0]
                    pack_status = "MATCH"
                elif unknown_packs:
                    unknown_packs.sort(key=lambda x: not x["is_primary"])
                    best_match = unknown_packs[0]
                    pack_status = "UNKNOWN"
                elif mismatches:
                    mismatches.sort(key=lambda x: not x["is_primary"])
                    best_match = mismatches[0]
                    pack_status = "MISMATCH"
                    
                if best_match:
                    match_status = "MATCHED"

            # Update catalog_chk
            c = catalog_chk[pid]
            c["match_status"] = match_status
            c["pack_quantity_status"] = pack_status
            c["amazon_asin"] = best_match["asin"] if best_match else None
            c["amazon_title"] = best_match["amazon_title"] if best_match else None
            c["selected_supplier_barcode"] = best_match["barcode"] if best_match else None
            c["supplier_pack_quantity"] = best_match["carpan"] if best_match else None
            c["is_primary_barcode"] = best_match["is_primary"] if best_match else None

    # Re-evaluate all PACK_MISMATCH with the new regex
    pack_mismatch_pids = [pid for pid, c in catalog_chk.items() if c.get("pack_quantity_status") == "MISMATCH"]
    logger.info(f"Re-evaluating {len(pack_mismatch_pids)} pack mismatches with new regex...")
    for pid in pack_mismatch_pids:
        c = catalog_chk[pid]
        title = c.get("amazon_title")
        if title:
            new_pack = extract_pack_quantity(title)
            carpan = c.get("supplier_pack_quantity")
            if new_pack is None:
                c["pack_quantity_status"] = "UNKNOWN"
            elif new_pack == carpan:
                c["pack_quantity_status"] = "MATCH"
            else:
                c["pack_quantity_status"] = "MISMATCH"

    save_json(CHK_CATALOG, catalog_chk)
    
    # 3. MFN Pricing/Fees Gap
    # If the ambiguous items found new ASINs, they might need pricing.
    asins_to_price = set()
    for pid, c in catalog_chk.items():
        asin = c.get("amazon_asin")
        if c["match_status"] == "MATCHED" and asin and asin not in pricing_chk:
            asins_to_price.add(asin)
            
    asins_to_price = list(asins_to_price)
    if asins_to_price:
        logger.info(f"Pricing {len(asins_to_price)} newly resolved ASINs...")
        for batch in chunk_list(asins_to_price, 20):
            requests_list = [{"uri": f"/products/pricing/v0/items/{a}/offers", "method": "GET", "MarketplaceId": MARKETPLACE_ID, "ItemCondition": "New"} for a in batch]
            try:
                res = call_sp_api("POST", "/batches/products/pricing/v0/itemOffers", data={"requests": requests_list})
                for r in res.get("responses", []):
                    status = r.get("status", {}).get("statusCode")
                    body = r.get("body", {})
                    asin = body.get("payload", {}).get("ASIN")
                    if status == 200 and asin:
                        summary = body.get("payload", {}).get("Summary", {})
                        lp = summary.get("LowestPrices", [])
                        bb = summary.get("BuyBoxPrices", [])
                        price = (bb[0].get("LandedPrice", {}).get("Amount") if bb else None) or (lp[0].get("LandedPrice", {}).get("Amount") if lp else None)
                        pricing_chk[asin] = {"amazon_price": price, "status": "SUCCESS" if price else "NO_OFFER"}
                    elif asin:
                        pricing_chk[asin] = {"amazon_price": None, "status": "NO_OFFER" if status == 200 else "ERROR"}
            except Exception as e:
                for a in batch: pricing_chk[a] = {"amazon_price": None, "status": "API_INCOMPLETE"}
        save_json(CHK_PRICING, pricing_chk)

    # 4. Fetch MFN Fees
    mfn_fee_reqs = []
    for pid, c in catalog_chk.items():
        asin = c.get("amazon_asin")
        if not asin: continue
        p_info = pricing_chk.get(asin, {})
        if p_info.get("amazon_price") and asin not in fees_mfn:
            mfn_fee_reqs.append({"asin": asin, "price": p_info["amazon_price"]})
            
    unique_mfn = {r["asin"]: r["price"] for r in mfn_fee_reqs}
    mfn_items = list(unique_mfn.items())
    
    if mfn_items:
        logger.info(f"Fetching MFN Fees for {len(mfn_items)} ASINs...")
        for batch in chunk_list(mfn_items, 20):
            payload = []
            for asin, price in batch:
                payload.append({
                    "FeesEstimateRequest": {
                        "MarketplaceId": MARKETPLACE_ID,
                        "IsAmazonFulfilled": False, # MFN
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
                    error = item.get("Error", {}).get("Code")
                    if status == "Success":
                        fee = item.get("FeesEstimate", {}).get("TotalFeesEstimate", {}).get("Amount")
                        fees_mfn[asin] = {"amazon_fee": fee, "status": "SUCCESS"}
                    else:
                        fees_mfn[asin] = {"amazon_fee": None, "status": "ERROR", "reason": error}
            except Exception as e:
                for asin, _ in batch: fees_mfn[asin] = {"amazon_fee": None, "status": "API_INCOMPLETE", "reason": str(e)}
        save_json(CHK_FEES_MFN, fees_mfn)

    # 5. Final Classification and Funnel Generation
    logger.info("Generating Classification and Funnels...")
    
    stats = {
        "funnel_amazon_matched": 0,
        "funnel_active_offers": 0,
        "funnel_mfn_fee_calc": 0,
        
        "margin_gt_10": 0,
        "margin_gt_20": 0,
        "margin_gt_30": 0,
        
        "contrib_gt_0": 0,
        "contrib_gt_50": 0,
        "contrib_gt_100": 0,
        
        "id_high": 0,
        "id_medium": 0,
        "id_unknown": 0,
        
        "AUTO_OPPORTUNITY": 0,
        "REVIEW_REQUIRED": 0,
        "REJECT": 0,
        "API_INCOMPLETE": 0,
        
        # Original metrics
        "total_pack_mismatch": sum(1 for c in catalog_chk.values() if c.get("pack_quantity_status") == "MISMATCH"),
        "total_ambiguous": sum(1 for c in catalog_chk.values() if c.get("match_status") == "MULTI_BARCODE_AMBIGUOUS"),
        
        # Fee breakdown
        "fee_breakdown_success": 0,
        "fee_breakdown_client_error": 0,
        "fee_breakdown_invalid_asin": 0,
        "fee_breakdown_no_offer": 0
    }
    
    final_output = []
    
    for pid, c in catalog_chk.items():
        row = c.copy()
        asin = row.get("amazon_asin")
        
        p_info = pricing_chk.get(asin, {}) if asin else {}
        f_info_mfn = fees_mfn.get(asin, {}) if asin else {}
        f_info_fba = fees_fba.get(asin, {}) if asin else {}
        cost_info = cost_chk.get(pid, {})
        
        row["amazon_price"] = p_info.get("amazon_price")
        row["amazon_fee_mfn"] = f_info_mfn.get("amazon_fee")
        row["amazon_fee_fba"] = f_info_fba.get("amazon_fee")
        row["supplier_cost_inc_vat"] = cost_info.get("supplier_cost_inc_vat")
        row["supplier_cost_confidence"] = cost_info.get("supplier_cost_confidence", "UNVERIFIED")
        row["margin_anomaly_status"] = "OK"
        row["estimated_contribution_mfn"] = None
        row["margin_pct_mfn"] = None
        row["minimum_purchase_cash_required"] = None
        row["fee_failure_reason"] = f_info_mfn.get("reason", "")
        
        if row["match_status"] == "MATCHED":
            stats["funnel_amazon_matched"] += 1
            if row["pack_quantity_status"] == "MATCH":
                row["barcode_match_confidence"] = "HIGH" if row.get("is_primary_barcode") else "MEDIUM_HIGH"
                stats["id_high"] += 1
            elif row["pack_quantity_status"] == "MISMATCH":
                row["barcode_match_confidence"] = "REJECT"
            else:
                row["barcode_match_confidence"] = "MEDIUM" if row.get("is_primary_barcode") else "LOW"
                stats["id_unknown"] += 1
        else:
            row["barcode_match_confidence"] = "REJECT"
            
        if row["amazon_price"]:
            stats["funnel_active_offers"] += 1
            if not row["amazon_fee_mfn"]:
                stats["fee_breakdown_client_error"] += 1
            else:
                stats["fee_breakdown_success"] += 1
                stats["funnel_mfn_fee_calc"] += 1
        else:
            if row["match_status"] == "MATCHED":
                stats["fee_breakdown_no_offer"] += 1
                
        # Math for MFN
        if row["amazon_price"] and row["supplier_cost_inc_vat"] and row["supplier_pack_quantity"]:
            total_cost = row["supplier_cost_inc_vat"] * int(row["supplier_pack_quantity"])
            row["calculated_supplier_cost"] = total_cost
            row["minimum_purchase_cash_required"] = round(row["supplier_cost_inc_vat"] * base_min_orders.get(pid, 1), 2)
            
            if float(row["amazon_price"]) / total_cost > 4.0:
                row["margin_anomaly_status"] = "HIGH_MARGIN_REVIEW"
                
            if row["amazon_fee_mfn"]:
                profit = float(row["amazon_price"]) - float(row["amazon_fee_mfn"]) - total_cost
                row["estimated_contribution_mfn"] = round(profit, 2)
                row["margin_pct_mfn"] = round((profit / float(row["amazon_price"])) * 100, 2)
                
                if profit > 0: stats["contrib_gt_0"] += 1
                if profit > 50: stats["contrib_gt_50"] += 1
                if profit > 100: stats["contrib_gt_100"] += 1
                
                if row["margin_pct_mfn"] > 10: stats["margin_gt_10"] += 1
                if row["margin_pct_mfn"] > 20: stats["margin_gt_20"] += 1
                if row["margin_pct_mfn"] > 30: stats["margin_gt_30"] += 1
        
        # Classification Logic
        is_api_incomplete = (
            p_info.get("status") == "API_INCOMPLETE" or 
            f_info_mfn.get("status") == "API_INCOMPLETE" or
            cost_info.get("supplier_cost_confidence") == "API_INCOMPLETE"
        )
        
        is_reject = (
            row["match_status"] != "MATCHED" or 
            row["pack_quantity_status"] == "MISMATCH" or
            p_info.get("status") in ["ERROR", "NO_OFFER"] or
            f_info_mfn.get("status") == "ERROR" or
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

    # File Writing
    def write_csv(filename, rows):
        if not rows: return
        keys = list(rows[0].keys())
        with open(filename, "w", encoding='utf-8-sig', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=keys, extrasaction='ignore')
            writer.writeheader()
            writer.writerows(rows)
            
    auto_opps = [r for r in final_output if r["final_opportunity_status"] == "AUTO_OPPORTUNITY"]
    reviews = [r for r in final_output if r["final_opportunity_status"] == "REVIEW_REQUIRED"]
    
    # Profitable reviews
    profitable_reviews = [r for r in reviews if r.get("estimated_contribution_mfn") and r["estimated_contribution_mfn"] > 0]
    negative_reviews = [r for r in reviews if r.get("estimated_contribution_mfn") and r["estimated_contribution_mfn"] <= 0]
    
    auto_opps.sort(key=lambda x: x.get("estimated_contribution_mfn") or -999, reverse=True)
    profitable_reviews.sort(key=lambda x: x.get("estimated_contribution_mfn") or -999, reverse=True)
    
    write_csv("amazon_opportunities.csv", auto_opps)
    write_csv("amazon_review_required.csv", reviews)
    write_csv("review_profitable_candidates.csv", profitable_reviews)
    write_csv("amazon_full_analysis_mfn.csv", final_output)
    
    print("\n" + "="*70)
    print("MFN PROFITABILITY & AUDIT REPORT")
    print("="*70)
    print("--- 1. AUDIT RECOVERIES ---")
    print(f"Original Ambiguous: 499 -> New Ambiguous: {stats['total_ambiguous']}")
    print(f"Original Mismatches: 571 -> New Mismatches: {stats['total_pack_mismatch']}")
    print("")
    print("--- 2. OFFER TO FEE FUNNEL (MFN) ---")
    print(f"Amazon Matched Products: {stats['funnel_amazon_matched']}")
    print(f"Active Offers (Priced): {stats['funnel_active_offers']}")
    print(f"MFN Fee Success: {stats['funnel_mfn_fee_calc']}")
    print(f"  - Failed due to ClientError (Missing dimensions, etc): {stats['fee_breakdown_client_error']}")
    print("")
    print("--- 3. PROFITABILITY FUNNEL (MFN) ---")
    print(f"Positive Contribution (> 0 TL): {stats['contrib_gt_0']}")
    print(f"Contribution > 50 TL: {stats['contrib_gt_50']}")
    print(f"Contribution > 100 TL: {stats['contrib_gt_100']}")
    print(f"Margin > 10%: {stats['margin_gt_10']}")
    print(f"Margin > 20%: {stats['margin_gt_20']}")
    print(f"Margin > 30%: {stats['margin_gt_30']}")
    print("")
    print("--- 4. CLASSIFICATION RESULTS ---")
    print(f"AUTO_OPPORTUNITY: {stats['AUTO_OPPORTUNITY']}")
    print(f"REVIEW_REQUIRED Total: {stats['REVIEW_REQUIRED']}")
    print(f"  - Profitable (Needs manual check): {len(profitable_reviews)}")
    print(f"  - Negative (Loss): {len(negative_reviews)}")
    print(f"REJECT: {stats['REJECT']}")
    print(f"API_INCOMPLETE: {stats['API_INCOMPLETE']}")
    print("="*70)
    
    if auto_opps:
        print("\nTOP 30 AUTO_OPPORTUNITIES (MFN):")
        for r in auto_opps[:30]:
            print(f"- {r['supplier_title'][:40]} | ASIN: {r['amazon_asin']} | Cost: {r['calculated_supplier_cost']} | Price: {r['amazon_price']} | MFN Fee: {r['amazon_fee_mfn']} | FBA Fee: {r['amazon_fee_fba']} | Profit: {r['estimated_contribution_mfn']} TL | Margin: {r['margin_pct_mfn']}%")

    if profitable_reviews:
        print("\nTOP 10 PROFITABLE REVIEW_REQUIRED:")
        for r in profitable_reviews[:10]:
            print(f"- {r['supplier_title'][:40]} | ASIN: {r['amazon_asin']} | Reason: {r['barcode_match_confidence']}/{r['pack_quantity_status']}/{r['margin_anomaly_status']} | Profit: {r['estimated_contribution_mfn']} TL")

if __name__ == "__main__":
    run_audit()
