import json
import csv
import sys
import os
import time
import logging

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from amazon_analyzer.normalizer import normalize_identifier
from amazon_analyzer.client import call_sp_api
from amazon_analyzer.auth import MARKETPLACE_ID

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s', datefmt='%H:%M:%S')
logger = logging.getLogger(__name__)

ENRICHED_CSV = r"C:\Users\kiyar\Desktop\adana-ozel-ders\backend\scripts\yildirim_multibarcode_enriched_2026_09_30.csv"
CHK_CATALOG = "scan_checkpoint_catalog.json"
CHK_PRICING = "scan_checkpoint_pricing.json"
CHK_FEES_MFN = "scan_checkpoint_fees_mfn.json"

def chunk_list(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def extract_pack_quantity(title: str) -> int:
    if not title: return None
    import re
    m = re.search(r'\b(\d+)\s*(?:[\'’‘`]?\s*[Ll][IİııUÜüü]\b|ADET\b|PAR[ÇC]A\b|PACK\b|PCS\b)', title, re.IGNORECASE)
    if m: return int(m.group(1))
    m_pack = re.search(r'\bPACK\s+OF\s+(\d+)\b', title, re.IGNORECASE)
    if m_pack: return int(m_pack.group(1))
    return None

def run():
    sys.stdout.reconfigure(encoding='utf-8')
    catalog_chk = json.load(open(CHK_CATALOG, 'r', encoding='utf-8'))
    pricing_chk = json.load(open(CHK_PRICING, 'r', encoding='utf-8')) if os.path.exists(CHK_PRICING) else {}
    fees_mfn = json.load(open(CHK_FEES_MFN, 'r', encoding='utf-8')) if os.path.exists(CHK_FEES_MFN) else {}
    
    enriched = {}
    with open(ENRICHED_CSV, 'r', encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            enriched[r["supplier_product_id"]] = r

    # 1. CORRECTED COUNTS
    total_supplier_products = len(catalog_chk)
    book_products = 0
    nonbook_products = 0
    
    total_barcode_candidates = 0
    book_barcode_candidates = 0
    nonbook_barcode_candidates = 0
    
    book_pids = []
    
    for pid, c in catalog_chk.items():
        prim = c.get("primary_barcode", "")
        enr = enriched.get(pid, {})
        barcodes = [b for b in enr.get("all_barcodes", "").split("|") if b.strip()]
        b_count = len(barcodes)
        
        total_barcode_candidates += b_count
        
        is_book = prim.startswith("978") or prim.startswith("979")
        if is_book:
            book_products += 1
            book_barcode_candidates += b_count
            book_pids.append(pid)
        else:
            nonbook_products += 1
            nonbook_barcode_candidates += b_count
            
    print("="*60)
    print("1. CORRECTED COUNTS")
    print("="*60)
    print(f"Total Supplier Products: {total_supplier_products}")
    print(f"Total Barcode Candidates: {total_barcode_candidates}")
    print(f"Book Products (978/979): {book_products}")
    print(f"Book Barcode Candidates: {book_barcode_candidates}")
    print(f"Non-Book Products: {nonbook_products}")
    print(f"Non-Book Barcode Candidates: {nonbook_barcode_candidates}")
    
    # Old stats
    old_books_matched = sum(1 for pid in book_pids if catalog_chk[pid].get("match_status") == "MATCHED")
    old_nonbooks_matched = sum(1 for pid, c in catalog_chk.items() if pid not in book_pids and c.get("match_status") == "MATCHED")
    print(f"\nOld Book Match Rate: {old_books_matched} / {book_products} ({(old_books_matched/book_products*100) if book_products else 0:.2f}%)")
    print(f"Old Non-Book Match Rate: {old_nonbooks_matched} / {nonbook_products} ({(old_nonbooks_matched/nonbook_products*100) if nonbook_products else 0:.2f}%)")
    
    # 2. SANITY CHECK 20 BOOKS
    sanity_pids = [pid for pid in book_pids if catalog_chk[pid].get("match_status") == "NOT_FOUND"][:20]
    sanity_req = []
    for pid in sanity_pids:
        b = catalog_chk[pid].get("primary_barcode", "")
        norm_b, b_type, valid = normalize_identifier(b)
        sanity_req.append((pid, b, norm_b, b_type))
        
    batch_identifiers = [req[2] for req in sanity_req]
    
    print("\n" + "="*60)
    print("2. SANITY CHECK (20 BOOKS)")
    print("="*60)
    
    params = {
        "identifiers": ",".join(batch_identifiers),
        "identifiersType": "EAN",
        "marketplaceIds": MARKETPLACE_ID,
        "includedData": "summaries,identifiers"
    }
    
    res = call_sp_api("GET", "/catalog/2022-04-01/items", params=params)
    
    amz_items_map = {}
    for item in res.get("items", []):
        for ident in item.get("identifiers", []):
            for id_obj in ident.get("identifiers", []):
                if id_obj.get("identifierType") == "EAN":
                    amz_items_map[id_obj.get("identifier")] = item
                    
    sanity_matched = 0
    for pid, orig_b, norm_b, b_type in sanity_req:
        item = amz_items_map.get(norm_b)
        c = catalog_chk[pid]
        old_status = c.get("match_status")
        
        asin = item.get("asin") if item else "NONE"
        amz_title = item.get("summaries", [{}])[0].get("itemName") if item else "NONE"
        
        returned_ean = "NONE"
        returned_isbn = "NONE"
        
        if item:
            for ident in item.get("identifiers", []):
                for id_obj in ident.get("identifiers", []):
                    if id_obj.get("identifierType") == "EAN": returned_ean = id_obj.get("identifier")
                    if id_obj.get("identifierType") == "ISBN": returned_isbn = id_obj.get("identifier")
        
        new_status = "MATCHED" if item else "NOT_FOUND"
        if item: sanity_matched += 1
        
        print(f"\n--- {pid} : {c.get('supplier_title')[:30]} ---")
        print(f"Original: {orig_b} -> Norm: {norm_b} (Type: EAN)")
        print(f"Amz Items Count for this EAN: {1 if item else 0}")
        print(f"Returned EAN: {returned_ean} | Returned ISBN: {returned_isbn}")
        print(f"ASIN: {asin}")
        print(f"Status Change: {old_status} -> {new_status}")
        
    if sanity_matched == 0:
        print("Sanity check failed to recover any books! Exiting.")
        return
        
    print(f"\nSanity check successfully recovered {sanity_matched}/20 books!")
    print("Proceeding to FULL BOOK RECOVERY...")
    
    # 3. FULL BOOK RECOVERY (Catalog)
    book_barcodes = set()
    barcode_to_book = {} # norm_b -> list of (pid, carpan, is_primary)
    
    for pid in book_pids:
        enr = enriched[pid]
        p_barcodes = enr.get("all_barcodes", "").split("|")
        p_multis = enr.get("all_multipliers", "").split("|")
        primary = enr.get("primary_barcode", "")
        for b, m in zip(p_barcodes, p_multis):
            norm_b, b_type, valid = normalize_identifier(b)
            if valid and b_type == "EAN":
                book_barcodes.add(norm_b)
                barcode_to_book.setdefault(norm_b, []).append((pid, int(m), norm_b == primary))
                
    book_barcodes = list(book_barcodes)
    logger.info(f"Fetching catalog for {len(book_barcodes)} distinct book EANs...")
    
    recovered_items_map = {}
    
    for batch in chunk_list(book_barcodes, 20):
        try:
            params = {
                "identifiers": ",".join(batch),
                "identifiersType": "EAN",
                "marketplaceIds": MARKETPLACE_ID,
                "includedData": "summaries,identifiers"
            }
            res = call_sp_api("GET", "/catalog/2022-04-01/items", params=params)
            for item in res.get("items", []):
                for ident in item.get("identifiers", []):
                    for id_obj in ident.get("identifiers", []):
                        if id_obj.get("identifierType") == "EAN":
                            recovered_items_map.setdefault(id_obj.get("identifier"), []).append(item)
        except Exception as e:
            logger.error(f"Book Catalog batch error: {e}")
            
    # Process matches
    for pid in book_pids:
        enr = enriched[pid]
        p_barcodes = enr.get("all_barcodes", "").split("|")
        p_multis = enr.get("all_multipliers", "").split("|")
        primary = enr.get("primary_barcode", "")
        
        candidates = []
        for b, m in zip(p_barcodes, p_multis):
            norm_b, _, valid = normalize_identifier(b)
            if valid and norm_b in recovered_items_map:
                for amz_item in recovered_items_map[norm_b]:
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
        
        if candidates:
            exact_packs = [c for c in candidates if c["amazon_pack"] == c["carpan"]]
            unknown_packs = [c for c in candidates if c["amazon_pack"] is None]
            mismatches = [c for c in candidates if c["amazon_pack"] is not None and c["amazon_pack"] != c["carpan"]]
            
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
                
            if best_match: match_status = "MATCHED"

        c = catalog_chk[pid]
        c["match_status"] = match_status
        c["pack_quantity_status"] = pack_status
        c["amazon_asin"] = best_match["asin"] if best_match else None
        c["amazon_title"] = best_match["amazon_title"] if best_match else None
        c["selected_supplier_barcode"] = best_match["barcode"] if best_match else None
        c["supplier_pack_quantity"] = best_match["carpan"] if best_match else None
        c["is_primary_barcode"] = best_match["is_primary"] if best_match else None
        
    save_json(CHK_CATALOG, catalog_chk)
    
    # 4. RECOVERY PRICING
    new_asins_to_price = []
    for pid in book_pids:
        asin = catalog_chk[pid].get("amazon_asin")
        if asin and asin not in pricing_chk:
            new_asins_to_price.append(asin)
            
    new_asins_to_price = list(set(new_asins_to_price))
    logger.info(f"Fetching pricing for {len(new_asins_to_price)} newly recovered book ASINs...")
    
    new_priced_count = 0
    for batch in chunk_list(new_asins_to_price, 20):
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
                    if price: new_priced_count += 1
                elif asin:
                    pricing_chk[asin] = {"amazon_price": None, "status": "NO_OFFER" if status == 200 else "ERROR"}
        except Exception as e:
            for a in batch: pricing_chk[a] = {"amazon_price": None, "status": "API_INCOMPLETE"}
            
    save_json(CHK_PRICING, pricing_chk)
    
    # 5. RECOVERY MFN FEES
    mfn_reqs = []
    for pid in book_pids:
        asin = catalog_chk[pid].get("amazon_asin")
        if asin:
            p_info = pricing_chk.get(asin, {})
            if p_info.get("amazon_price") and asin not in fees_mfn:
                mfn_reqs.append((asin, p_info["amazon_price"]))
                
    mfn_reqs = list(set(mfn_reqs))
    logger.info(f"Fetching MFN Fees for {len(mfn_reqs)} newly priced book ASINs...")
    
    new_mfn_success = 0
    for batch in chunk_list(mfn_reqs, 20):
        payload = []
        for asin, price in batch:
            payload.append({
                "FeesEstimateRequest": {
                    "MarketplaceId": MARKETPLACE_ID,
                    "IsAmazonFulfilled": False,
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
                    new_mfn_success += 1
                else:
                    fees_mfn[asin] = {"amazon_fee": None, "status": "ERROR", "reason": error}
        except Exception as e:
            for asin, _ in batch: fees_mfn[asin] = {"amazon_fee": None, "status": "API_INCOMPLETE", "reason": str(e)}
            
    save_json(CHK_FEES_MFN, fees_mfn)
    
    # Final Reporting
    new_books_matched = sum(1 for pid in book_pids if catalog_chk[pid].get("match_status") == "MATCHED")
    new_books_not_found = sum(1 for pid in book_pids if catalog_chk[pid].get("match_status") == "NOT_FOUND")
    new_total_matched = sum(1 for c in catalog_chk.values() if c.get("match_status") == "MATCHED")
    
    print("\n" + "="*60)
    print("3. RECOVERY FINAL REPORT")
    print("="*60)
    print(f"Books Matched BEFORE: {old_books_matched}")
    print(f"Books Matched AFTER: {new_books_matched}")
    print(f"Books NOT_FOUND AFTER: {new_books_not_found}")
    print(f"Newly Recovered ASINs: {len(new_asins_to_price)}")
    print(f"Newly Recovered Offers: {new_priced_count}")
    print(f"Newly Recovered MFN Fees Success: {new_mfn_success}")
    print(f"New Total Catalog Matched Products: {new_total_matched}")
    print(f"New Overall Match Rate: {new_total_matched / total_supplier_products * 100:.2f}%")
    print(f"New Book Match Rate: {new_books_matched / book_products * 100:.2f}%")
    print(f"Non-Book Match Rate: {old_nonbooks_matched / nonbook_products * 100:.2f}%")
    
    print("\nSAMPLE OF 20 NEWLY MATCHED BOOKS:")
    sample = [c for pid, c in catalog_chk.items() if pid in book_pids and c.get("match_status") == "MATCHED"][:20]
    for s in sample:
        print(f"Supplier Title: {s.get('supplier_title')[:30]} | EAN: {s.get('primary_barcode')} | ASIN: {s.get('amazon_asin')} | Amz Title: {s.get('amazon_title')[:30]}")

if __name__ == "__main__":
    run()
