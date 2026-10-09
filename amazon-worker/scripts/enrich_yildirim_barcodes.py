import csv
import json
import logging
import asyncio
import httpx
from typing import Dict, Any, List, Optional
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from amazon_analyzer.normalizer import normalize_identifier

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s', datefmt='%H:%M:%S')
logger = logging.getLogger(__name__)

CSV_PATH = r"C:\Users\kiyar\Desktop\iş kültür scrapping\outputs\guncel_stok_2026_09_30.csv"
CHECKPOINT_PATH = r"C:\Users\kiyar\Desktop\adana-ozel-ders\backend\scripts\yildirim_enriched_checkpoint.json"
OUTPUT_CSV = r"C:\Users\kiyar\Desktop\adana-ozel-ders\backend\scripts\yildirim_multibarcode_enriched_2026_09_30.csv"

def load_checkpoint() -> Dict[str, Any]:
    if os.path.exists(CHECKPOINT_PATH):
        try:
            with open(CHECKPOINT_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_checkpoint(data: Dict[str, Any]):
    with open(CHECKPOINT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

async def fetch_product_details_with_retry(pid: int, sem: asyncio.Semaphore, client: httpx.AsyncClient) -> Optional[Dict]:
    url = f"https://b2b.yildirimdagitim.com/api/vitrin/urun/{pid}"
    headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.0"}
    
    max_retries = 3
    base_delay = 2.0
    
    async with sem:
        for attempt in range(max_retries):
            try:
                r = await client.get(url, headers=headers)
                if r.status_code == 200:
                    return r.json()
                elif r.status_code == 429:
                    await asyncio.sleep(base_delay * (2 ** attempt))
                elif r.status_code >= 500:
                    await asyncio.sleep(base_delay * (2 ** attempt))
                else:
                    return None
            except Exception as e:
                await asyncio.sleep(base_delay * (2 ** attempt))
    return None

async def enrich_11491_products():
    logger.info("Loading CSV...")
    products = []
    with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            pid_str = row.get("id", "0")
            if pid_str.isdigit() and int(pid_str) > 0:
                products.append(row)
                
    logger.info(f"Loaded {len(products)} products from CSV.")
    
    checkpoint_data = load_checkpoint()
    logger.info(f"Loaded {len(checkpoint_data)} products from checkpoint.")
    
    # Filter products that still need processing
    products_to_process = [p for p in products if str(p["id"]) not in checkpoint_data]
    logger.info(f"Products remaining to process: {len(products_to_process)}")
    
    # Concurrency limit to protect Yildirim API
    concurrency = 15
    sem = asyncio.Semaphore(concurrency)
    
    saved_count = 0
    total_processed = 0
    
    async def process_item(client, prod):
        nonlocal saved_count, total_processed
        pid = int(prod["id"])
        
        details = await fetch_product_details_with_retry(pid, sem, client)
        
        primary_barcode = prod.get("barkod", "").strip()
        title = prod.get("ad", "").strip()
        code = prod.get("kod", "").strip()
        
        if details:
            barkodlar = details.get("barkodlar", [])
            checkpoint_data[str(pid)] = {
                "supplier_product_id": pid,
                "supplier_code": code,
                "supplier_title": title,
                "primary_barcode": primary_barcode,
                "barkodlar": barkodlar,
                "status": "SUCCESS"
            }
        else:
            checkpoint_data[str(pid)] = {
                "supplier_product_id": pid,
                "supplier_code": code,
                "supplier_title": title,
                "primary_barcode": primary_barcode,
                "barkodlar": [],
                "status": "FAILED"
            }
            
        total_processed += 1
        if total_processed % 100 == 0:
            logger.info(f"Processed {total_processed}/{len(products_to_process)}. Saving checkpoint...")
            save_checkpoint(checkpoint_data)
            
    timeout = httpx.Timeout(20.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        tasks = [process_item(client, p) for p in products_to_process]
        
        chunk_size = 500
        for i in range(0, len(tasks), chunk_size):
            chunk = tasks[i:i+chunk_size]
            await asyncio.gather(*chunk)
            save_checkpoint(checkpoint_data)
            
    logger.info("Enrichment complete. Generating CSV and Metrics...")
    
    # Generate CSV and Metrics
    output_rows = []
    
    metric_total = len(checkpoint_data)
    metric_success = 0
    metric_failed = 0
    metric_single = 0
    metric_multi = 0
    metric_alt_barcodes = 0
    carpan_dist = {}
    unit_dist = {}
    max_barcodes_count = 0
    max_barcodes_pid = None
    barcode_to_pids = {}
    broken_carpan = 0
    
    for pid_str, data in checkpoint_data.items():
        if data["status"] == "FAILED":
            metric_failed += 1
        else:
            metric_success += 1
            
        barkodlar = data.get("barkodlar", [])
        
        all_barcodes = []
        all_units = []
        all_multipliers = []
        
        if barkodlar:
            if len(barkodlar) > 1:
                metric_multi += 1
                metric_alt_barcodes += (len(barkodlar) - 1)
            else:
                metric_single += 1
                
            if len(barkodlar) > max_barcodes_count:
                max_barcodes_count = len(barkodlar)
                max_barcodes_pid = pid_str
                
            for b in barkodlar:
                b_val = str(b.get("barkod", "")).strip()
                unit = str(b.get("ad", "")).strip()
                carpan = int(b.get("carpan", 0) or 0)
                
                if carpan <= 0:
                    broken_carpan += 1
                    
                all_barcodes.append(b_val)
                all_units.append(unit)
                all_multipliers.append(str(carpan))
                
                carpan_dist[carpan] = carpan_dist.get(carpan, 0) + 1
                unit_dist[unit] = unit_dist.get(unit, 0) + 1
                
                if b_val:
                    barcode_to_pids.setdefault(b_val, set()).add(pid_str)
                    
            mb_status = "MULTI" if len(barkodlar) > 1 else "SINGLE"
        else:
            metric_single += 1 # Treating no barkodlar array as single using primary
            mb_status = "FAILED_OR_EMPTY"
            if data["primary_barcode"]:
                all_barcodes.append(data["primary_barcode"])
                all_units.append("UNKNOWN")
                all_multipliers.append("1")
                carpan_dist[1] = carpan_dist.get(1, 0) + 1
                barcode_to_pids.setdefault(data["primary_barcode"], set()).add(pid_str)
                
        output_rows.append({
            "supplier_product_id": data["supplier_product_id"],
            "supplier_code": data["supplier_code"],
            "supplier_title": data["supplier_title"],
            "primary_barcode": data["primary_barcode"],
            "barcode_count": len(barkodlar) or 1,
            "all_barcodes": "|".join(all_barcodes),
            "all_units": "|".join(all_units),
            "all_multipliers": "|".join(all_multipliers),
            "multibarcode_status": mb_status,
            "raw_barcodes_json": json.dumps(barkodlar, ensure_ascii=False) if barkodlar else ""
        })
        
    with open(OUTPUT_CSV, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=output_rows[0].keys())
        writer.writeheader()
        writer.writerows(output_rows)
        
    logger.info(f"Saved CSV to {OUTPUT_CSV}")
    
    duplicate_barcodes = {b: pids for b, pids in barcode_to_pids.items() if len(pids) > 1}
    
    print("\n" + "="*50)
    print("ENRICHMENT METRICS REPORT")
    print("="*50)
    print(f"Total Products Processed: {metric_total}")
    print(f"Detail API Success: {metric_success}")
    print(f"Detail API Failed: {metric_failed}")
    print(f"Single-Barcode Products: {metric_single}")
    print(f"Multi-Barcode Products: {metric_multi}")
    print(f"Total Alternative Barcodes: {metric_alt_barcodes}")
    print("-" * 50)
    print("Carpan (Multiplier) Distribution:")
    for k, v in sorted(carpan_dist.items()):
        print(f"  {k}: {v}")
    print("-" * 50)
    print("Unit Name Distribution:")
    for k, v in sorted(unit_dist.items(), key=lambda x: x[1], reverse=True):
        print(f"  {k}: {v}")
    print("-" * 50)
    print("Data Anomalies:")
    print(f"Products with Carpan <= 0: {broken_carpan}")
    print(f"Max Barcodes in Single Product: {max_barcodes_count} (ProductID: {max_barcodes_pid})")
    print(f"Barcodes assigned to Multiple Products (Duplicates): {len(duplicate_barcodes)}")
    if duplicate_barcodes:
        # show top 3
        count = 0
        for b, pids in duplicate_barcodes.items():
            print(f"  Barcode {b} -> Product IDs: {pids}")
            count += 1
            if count >= 3:
                print("  ... (truncated)")
                break
    print("="*50)


if __name__ == "__main__":
    asyncio.run(enrich_11491_products())
