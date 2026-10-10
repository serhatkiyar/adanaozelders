"""
nonbook_verification.py

Verification-only run for 2702 current NON-BOOK NOT_FOUND products.
- DOES NOT modify scan_checkpoint_catalog.json or any production checkpoint.
- Writes evidence to: nonbook_notfound_verification_evidence.jsonl
- Writes summary to: nonbook_notfound_verification_summary.csv
- Final product classification: RECOVERED / CONFIRMED_NOT_FOUND / CATALOG_INCOMPLETE / NO_VALID_IDENTIFIER
"""

import json
import csv
import time
import random
import sys
import os
import re
from datetime import datetime
from requests.exceptions import ReadTimeout

sys.path.append(os.path.abspath("backend"))
from amazon_analyzer.client import call_sp_api, SpApiRateLimitError, SpApiClientError

CHK_CATALOG    = "scan_checkpoint_catalog.json"
CHK_ENRICHED   = "backend/scripts/yildirim_enriched_checkpoint.json"
MARKETPLACE_ID = "A33AVAJ2PDY3EV"
EVIDENCE_FILE  = "nonbook_notfound_verification_evidence.jsonl"
SUMMARY_FILE   = "nonbook_notfound_verification_summary.csv"
PROGRESS_FILE  = "nonbook_verification_progress.json"

# ─────────────────────────────────────────────
# Identifier extraction (mirrors recover_non_book.py)
# ─────────────────────────────────────────────
def get_all_identifiers(barcodes_str):
    """Returns deduplicated list of (ident_str, id_type, original_raw)."""
    result = []
    if not barcodes_str:
        return result
    raw_list = barcodes_str.split("|")
    seen = set()

    def add(ident, t, raw):
        if ident not in seen:
            seen.add(ident)
            result.append((ident, t, raw))

    for raw in raw_list:
        b = raw.strip()
        if not b:
            continue
        clean = ''.join(c for c in b if c.isdigit() or c.upper() == 'X')
        if len(clean) == 13:
            add(clean, "EAN", raw)
        elif len(clean) == 12:
            add(clean, "UPC", raw)
            add("0" + clean, "EAN", raw)
        elif len(clean) == 10:
            add(clean, "ISBN", raw)
        elif len(clean) == 8:
            add(clean, "EAN", raw)

    return result

# ─────────────────────────────────────────────
# Semantic identity check
# ─────────────────────────────────────────────
CATEGORY_CONFLICT_PAIRS = [
    ({"kalem","silgi","defter","boya","boncuk","pano","kirtasiye","tasarim","kazima","sticker"},
     {"sandalet","terlik","ayakkabi","sutyen","giyim","shoes"}),
]

def normalize_text(text):
    if not text:
        return set()
    text = text.lower()
    tr = str.maketrans("ışğüöçİŞĞÜÖÇ", "isguocisguoc")
    text = text.translate(tr)
    text = re.sub(r'[^a-z0-9\s]', ' ', text)
    tokens = text.split()
    stop = {"ve","ile","icin","adet","li","lu","paket","kutu","renk","cm","mm","gr","kg","ml","lt","a","bir"}
    return set(t for t in tokens if len(t) > 2 and t not in stop)

def classify_identity(sup_title, amz_title, sup_brand=""):
    sup_tok = normalize_text(sup_title + " " + sup_brand)
    amz_tok = normalize_text(amz_title)
    if not sup_tok or not amz_tok:
        return "REVIEW"
    overlap = sup_tok & amz_tok
    for sup_cats, amz_cats in CATEGORY_CONFLICT_PAIRS:
        sup_hit = sup_tok & sup_cats
        amz_hit = amz_tok & amz_cats
        if sup_hit and amz_hit:
            return "CONFLICT"
    if overlap:
        return "TRUSTED"
    return "CONFLICT"

# ─────────────────────────────────────────────
# API call with local retry (max_retries=6)
# ─────────────────────────────────────────────
def catalog_batch_call(idents, id_type, stats):
    """
    Calls Catalog API for up to 20 identifiers of one type.
    Returns (response_dict_or_None, http_success, http_status, error_code, attempt_count).
    Never raises — all errors are captured.
    """
    max_retries = 6
    base_delay  = 1.5
    last_error_code = None
    last_error_msg  = None

    for attempt in range(max_retries + 1):
        stats["catalog_http_requests"] += 1
        try:
            res = call_sp_api("GET", "/catalog/2022-04-01/items", params={
                "identifiers":     ",".join(idents),
                "identifiersType": id_type,
                "marketplaceIds":  MARKETPLACE_ID,
                "includedData":    "summaries,identifiers"
            })
            stats["http_200"] += 1
            return res, True, 200, None, None, attempt + 1
        except SpApiRateLimitError as e:
            stats["http_429"] += 1
            last_error_code = "429"
            last_error_msg  = str(e)
            if attempt < max_retries:
                delay = base_delay * (2 ** attempt) + random.uniform(0.2, 0.8)
                stats["retries"] += 1
                time.sleep(delay)
            else:
                stats["retry_exhausted"] += 1
        except SpApiClientError as e:
            err = str(e)
            if "500" in err or "502" in err or "503" in err or "504" in err:
                stats["http_5xx"] += 1
                last_error_code = "5xx"
                last_error_msg  = err
                if attempt < max_retries:
                    delay = base_delay * (2 ** attempt)
                    stats["retries"] += 1
                    time.sleep(delay)
                else:
                    stats["retry_exhausted"] += 1
            else:
                # Client error (4xx, non-rate-limit) — do not retry
                last_error_code = "CLIENT_ERROR"
                last_error_msg  = err
                return None, False, None, last_error_code, last_error_msg, attempt + 1
        except ReadTimeout:
            stats["timeouts"] += 1
            last_error_code = "TIMEOUT"
            last_error_msg  = "ReadTimeout"
            if attempt < max_retries:
                delay = base_delay * (2 ** attempt)
                stats["retries"] += 1
                time.sleep(delay)
            else:
                stats["retry_exhausted"] += 1
        except Exception as e:
            last_error_code = "UNKNOWN"
            last_error_msg  = str(e)
            return None, False, None, last_error_code, last_error_msg, attempt + 1

    return None, False, None, last_error_code, last_error_msg, max_retries + 1

def chunk_list(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]

# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────
def run():
    start_time = time.time()

    catalog  = json.load(open(CHK_CATALOG,  "r", encoding="utf-8"))
    enriched = json.load(open(CHK_ENRICHED, "r", encoding="utf-8"))

    # ── STEP 1: Build cohort ──────────────────
    cohort = []
    for pid, c in catalog.items():
        pri = c.get("primary_barcode", "")
        is_book = pri.startswith("978") or pri.startswith("979")
        if not is_book and c.get("match_status") == "NOT_FOUND":
            cohort.append(pid)

    print(f"[COHORT] Current non-book NOT_FOUND: {len(cohort)}", flush=True)
    if len(cohort) != 2702:
        print(f"ERROR: Expected 2702, got {len(cohort)}. STOPPING.")
        sys.exit(1)

    # ── STEP 2: Load progress (resume support) ─
    already_done = set()
    if os.path.exists(PROGRESS_FILE):
        prog = json.load(open(PROGRESS_FILE, "r", encoding="utf-8"))
        already_done = set(prog.get("done_pids", []))
        print(f"[RESUME] {len(already_done)} PIDs already processed from previous run.", flush=True)

    # ── STEP 3: Build per-PID identifier map ──
    # pid -> {primary_barcode, supplier_title, supplier_brand,
    #         identifiers: [(ident, id_type, is_primary, carpan, raw)]}
    pid_meta = {}
    for pid in cohort:
        if pid in already_done:
            continue
        c   = catalog[pid]
        enr = enriched.get(str(pid), enriched.get(pid, {}))
        pri_raw = str(enr.get("primary_barcode") or c.get("primary_barcode") or "").strip()
        barkodlar = enr.get("barkodlar", [])
        if not barkodlar and pri_raw:
            barkodlar = [{"barkod": pri_raw, "carpan": 1}]

        carpan_map = {}
        all_raw_list = []
        for b_obj in barkodlar:
            b_str = str(b_obj.get("barkod", "")).strip()
            if b_str:
                all_raw_list.append(b_str)
                carpan_map[b_str] = int(b_obj.get("carpan", 1)) if str(b_obj.get("carpan", 1)).isdigit() else 1

        all_raw = "|".join(all_raw_list)
        idents = get_all_identifiers(all_raw)

        pid_meta[pid] = {
            "primary_barcode":  c.get("primary_barcode", ""),
            "supplier_title":   c.get("supplier_title", ""),
            "supplier_brand":   c.get("supplier_brand", ""),
            "carpan_map":       carpan_map,
            "identifiers":      [
                {"ident": ident, "id_type": t, "is_primary": (raw.strip() == pri_raw), "carpan": carpan_map.get(raw.strip(), 1), "raw": raw}
                for ident, t, raw in idents
            ]
        }

    pending_pids = [p for p in cohort if p not in already_done]
    print(f"[PENDING] {len(pending_pids)} PIDs to process this run.", flush=True)

    # ── STEP 4: Global identifier → batch map ─
    # Group all identifiers by id_type for batch processing
    # id_type -> [ {ident, pid, is_primary, carpan} ]
    global_ident_to_type = {}   # ident -> id_type (first seen wins)
    type_to_idents = {"EAN": [], "UPC": [], "ISBN": []}

    for pid in pending_pids:
        meta = pid_meta[pid]
        for id_info in meta["identifiers"]:
            ident   = id_info["ident"]
            id_type = id_info["id_type"]
            if ident not in global_ident_to_type:
                global_ident_to_type[ident] = id_type
                type_to_idents[id_type].append(ident)

    total_unique = sum(len(v) for v in type_to_idents.values())
    print(f"[IDENTIFIERS] Total unique: {total_unique} "
          f"(EAN:{len(type_to_idents['EAN'])} UPC:{len(type_to_idents['UPC'])} ISBN:{len(type_to_idents['ISBN'])})", flush=True)

    # ── STEP 5: API calls, collecting per-ident results ──
    stats = {
        "catalog_http_requests": 0,
        "http_200": 0, "http_429": 0, "http_5xx": 0,
        "timeouts": 0, "retries": 0, "retry_exhausted": 0,
        "logical_batches": 0,
    }

    # ident -> { http_success, http_status, item_count, asins, returned_identifiers, titles, error_code, error_msg, attempts }
    ident_results = {}

    def process_type(id_type, ident_list):
        batch_num = 0
        for chunk in chunk_list(ident_list, 20):
            batch_num += 1
            stats["logical_batches"] += 1
            if batch_num % 10 == 0:
                elapsed = time.time() - start_time
                print(f"  [{id_type}] batch {batch_num}/{(len(ident_list)+19)//20} | "
                      f"HTTP: {stats['http_200']} ok / {stats['http_429']} 429 | "
                      f"elapsed: {elapsed:.0f}s", flush=True)

            res, http_ok, http_st, err_code, err_msg, attempts = catalog_batch_call(chunk, id_type, stats)

            if http_ok and res is not None:
                # Build returned identifier → items map
                ret_map = {ident: [] for ident in chunk}
                for amz_item in res.get("items", []):
                    returned_ids = set()
                    for id_block in amz_item.get("identifiers", []):
                        for m in id_block.get("identifiers", []):
                            returned_ids.add(m.get("identifier", "").strip())
                    for ident in chunk:
                        if ident in returned_ids:
                            ret_map[ident].append(amz_item)

                for ident in chunk:
                    matched = ret_map[ident]
                    ident_results[ident] = {
                        "http_success":        True,
                        "http_status":         200,
                        "item_count":          len(matched),
                        "asins":               [m.get("asin") for m in matched],
                        "returned_identifiers": [
                            mid.get("identifier")
                            for m in matched
                            for id_block in m.get("identifiers", [])
                            for mid in id_block.get("identifiers", [])
                        ],
                        "titles":              [
                            m.get("summaries", [{}])[0].get("itemName", "")
                            for m in matched
                        ],
                        "error_code":  None,
                        "error_msg":   None,
                        "attempts":    attempts
                    }
            else:
                # Batch failed
                for ident in chunk:
                    ident_results[ident] = {
                        "http_success":        False,
                        "http_status":         http_st,
                        "item_count":          None,
                        "asins":               [],
                        "returned_identifiers": [],
                        "titles":              [],
                        "error_code":          err_code,
                        "error_msg":           err_msg,
                        "attempts":            attempts
                    }

    for id_type in ["EAN", "UPC", "ISBN"]:
        ident_list = type_to_idents[id_type]
        if not ident_list:
            continue
        print(f"\n[{id_type}] Processing {len(ident_list)} unique identifiers...", flush=True)
        process_type(id_type, ident_list)

    # ── STEP 6: Per-PID classification + evidence write ──
    summary_rows = []
    product_results = {}  # pid -> classification + match info

    evidence_fh = open(EVIDENCE_FILE, "a", encoding="utf-8")

    for pid in pending_pids:
        meta      = pid_meta[pid]
        sup_title = meta["supplier_title"]
        sup_brand = meta["supplier_brand"]
        pri_bc    = meta["primary_barcode"]
        all_idents = meta["identifiers"]

        if not all_idents:
            # No valid identifiers
            prod_cls = "NO_VALID_IDENTIFIER"
            best_match = None
        else:
            has_failure   = False
            has_match     = False
            best_match    = None
            all_success   = True

            for id_info in all_idents:
                ident   = id_info["ident"]
                id_type = id_info["id_type"]
                is_pri  = id_info["is_primary"]
                carpan  = id_info["carpan"]

                ir = ident_results.get(ident)
                if ir is None:
                    # Shouldn't happen, but treat as incomplete
                    all_success = False
                    has_failure = True
                    evidence_line = {
                        "supplier_product_id": pid,
                        "supplier_title":      sup_title,
                        "primary_barcode":     pri_bc,
                        "identifier":          ident,
                        "identifier_type":     id_type,
                        "is_primary":          is_pri,
                        "carpan":              carpan,
                        "http_success":        False,
                        "http_status":         None,
                        "attempt_count":       0,
                        "amazon_item_count":   None,
                        "returned_asins":      [],
                        "returned_identifiers":[],
                        "amazon_titles":       [],
                        "error_code":          "MISSING_RESULT",
                        "error_message":       "No result entry found"
                    }
                    evidence_fh.write(json.dumps(evidence_line, ensure_ascii=False) + "\n")
                    continue

                # Write evidence
                evidence_line = {
                    "supplier_product_id": pid,
                    "supplier_title":      sup_title,
                    "primary_barcode":     pri_bc,
                    "identifier":          ident,
                    "identifier_type":     id_type,
                    "is_primary":          is_pri,
                    "carpan":              carpan,
                    "http_success":        ir["http_success"],
                    "http_status":         ir["http_status"],
                    "attempt_count":       ir["attempts"],
                    "amazon_item_count":   ir["item_count"],
                    "returned_asins":      ir["asins"],
                    "returned_identifiers":ir["returned_identifiers"],
                    "amazon_titles":       ir["titles"],
                    "error_code":          ir["error_code"],
                    "error_message":       ir["error_msg"]
                }
                evidence_fh.write(json.dumps(evidence_line, ensure_ascii=False) + "\n")

                if not ir["http_success"]:
                    all_success = False
                    has_failure = True
                elif ir["item_count"] and ir["item_count"] > 0:
                    has_match = True
                    if best_match is None:
                        best_match = {
                            "matched_barcode":       ident,
                            "is_primary":            is_pri,
                            "carpan":                carpan,
                            "asin":                  ir["asins"][0] if ir["asins"] else None,
                            "amazon_title":          ir["titles"][0] if ir["titles"] else "",
                            "amazon_returned_ident": ir["returned_identifiers"][0] if ir["returned_identifiers"] else None,
                            "exact_identifier_match": ident in (ir["returned_identifiers"] or [])
                        }
                    elif is_pri and not best_match["is_primary"]:
                        # Prefer primary match
                        best_match = {
                            "matched_barcode":       ident,
                            "is_primary":            is_pri,
                            "carpan":                carpan,
                            "asin":                  ir["asins"][0] if ir["asins"] else None,
                            "amazon_title":          ir["titles"][0] if ir["titles"] else "",
                            "amazon_returned_ident": ir["returned_identifiers"][0] if ir["returned_identifiers"] else None,
                            "exact_identifier_match": ident in (ir["returned_identifiers"] or [])
                        }

            if has_match:
                # Classify identity
                amz_title  = best_match["amazon_title"]
                identity_cls = classify_identity(sup_title, amz_title, sup_brand)
                prod_cls = "RECOVERED"
                best_match["identity_classification"] = identity_cls
            elif has_failure:
                prod_cls = "CATALOG_INCOMPLETE"
            else:
                prod_cls = "CONFIRMED_NOT_FOUND"

        product_results[pid] = {
            "classification": prod_cls,
            "best_match": best_match
        }

        summary_rows.append({
            "supplier_product_id":    pid,
            "supplier_title":         sup_title,
            "primary_barcode":        pri_bc,
            "classification":         prod_cls,
            "matched_barcode":        best_match["matched_barcode"] if best_match else "",
            "is_primary":             best_match["is_primary"] if best_match else "",
            "carpan":                 best_match["carpan"] if best_match else "",
            "asin":                   best_match["asin"] if best_match else "",
            "amazon_title":           best_match["amazon_title"] if best_match else "",
            "exact_identifier_match": best_match.get("exact_identifier_match") if best_match else "",
            "identity_classification":best_match.get("identity_classification") if best_match else ""
        })

    evidence_fh.flush()
    evidence_fh.close()

    # Write summary CSV
    fieldnames = list(summary_rows[0].keys()) if summary_rows else []
    write_header = not os.path.exists(SUMMARY_FILE) or len(already_done) == 0
    with open(SUMMARY_FILE, "a", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if write_header:
            writer.writeheader()
        writer.writerows(summary_rows)

    # Update progress
    done_now = list(already_done) + pending_pids
    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        json.dump({"done_pids": done_now, "timestamp": datetime.utcnow().isoformat()}, f)

    # ── STEP 7: Aggregate and report ──────────
    # Load ALL summary rows (in case this is a resumed run)
    all_summary = []
    with open(SUMMARY_FILE, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            all_summary.append(row)

    counts = {"RECOVERED": 0, "CONFIRMED_NOT_FOUND": 0, "CATALOG_INCOMPLETE": 0, "NO_VALID_IDENTIFIER": 0}
    identity_counts = {"TRUSTED": 0, "REVIEW": 0, "CONFLICT": 0}
    recovered_rows = []

    for row in all_summary:
        cls = row["classification"]
        counts[cls] = counts.get(cls, 0) + 1
        if cls == "RECOVERED":
            recovered_rows.append(row)
            ic = row.get("identity_classification", "")
            if ic in identity_counts:
                identity_counts[ic] += 1

    elapsed = time.time() - start_time
    total = sum(counts.values())

    print("\n" + "="*60)
    print("VERIFICATION REPORT")
    print("="*60)
    print(f"INPUT_CURRENT_NONBOOK_NOT_FOUND : 2702")
    print(f"")
    print(f"RECOVERED                       : {counts.get('RECOVERED',0)}")
    print(f"  TRUSTED                       : {identity_counts['TRUSTED']}")
    print(f"  REVIEW                        : {identity_counts['REVIEW']}")
    print(f"  CONFLICT                      : {identity_counts['CONFLICT']}")
    print(f"")
    print(f"CONFIRMED_NOT_FOUND             : {counts.get('CONFIRMED_NOT_FOUND',0)}")
    print(f"CATALOG_INCOMPLETE              : {counts.get('CATALOG_INCOMPLETE',0)}")
    print(f"NO_VALID_IDENTIFIER             : {counts.get('NO_VALID_IDENTIFIER',0)}")
    print(f"")
    print(f"SUM                             : {total} {'✓' if total == 2702 else '✗ MISMATCH'}")
    print(f"")
    print(f"API STATS:")
    print(f"CATALOG_HTTP_REQUESTS           : {stats['catalog_http_requests']}")
    print(f"LOGICAL_BATCHES                 : {stats['logical_batches']}")
    print(f"HTTP_200                        : {stats['http_200']}")
    print(f"HTTP_429                        : {stats['http_429']}")
    print(f"HTTP_5XX                        : {stats['http_5xx']}")
    print(f"TIMEOUTS                        : {stats['timeouts']}")
    print(f"RETRIES                         : {stats['retries']}")
    print(f"RETRY_EXHAUSTED                 : {stats['retry_exhausted']}")
    print(f"TOTAL_RUNTIME                   : {elapsed:.0f}s ({elapsed/60:.1f}min)")
    print(f"")
    print(f"Evidence written to : {EVIDENCE_FILE}")
    print(f"Summary written to  : {SUMMARY_FILE}")

    # ── STEP 8: Print recovered sample ────────
    if recovered_rows:
        print(f"\n{'='*60}")
        print(f"RECOVERED PRODUCTS (all {len(recovered_rows)}):")
        print(f"{'='*60}")
        print(f"{'PID':<10} {'Title':<35} {'PriBC':<15} {'MatchBC':<15} {'P/A':<4} {'Crpn':<5} {'ASIN':<12} {'IdCls':<9} {'AmazonTitle'}")
        print("-" * 145)
        for row in recovered_rows[:50]:
            pa = "PRI" if str(row.get("is_primary")).lower() in ["true","1"] else "ALT"
            print(f"{row['supplier_product_id']:<10} "
                  f"{row['supplier_title'][:33]:<35} "
                  f"{row['primary_barcode']:<15} "
                  f"{row['matched_barcode']:<15} "
                  f"{pa:<4} "
                  f"{str(row.get('carpan','')):<5} "
                  f"{str(row.get('asin','')):<12} "
                  f"{str(row.get('identity_classification','')):<9} "
                  f"{row.get('amazon_title','')[:40]}")

        if len(recovered_rows) > 50:
            print(f"... and {len(recovered_rows)-50} more in {SUMMARY_FILE}")

        conflicts = [r for r in recovered_rows if r.get("identity_classification") == "CONFLICT"]
        if conflicts:
            print(f"\n{'='*60}")
            print(f"ALL CONFLICT ITEMS ({len(conflicts)}):")
            print(f"{'='*60}")
            for row in conflicts:
                print(f"  PID {row['supplier_product_id']} | {row['supplier_title'][:40]} | "
                      f"EAN: {row['primary_barcode']} | ASIN: {row['asin']} | {row['amazon_title'][:40]}")

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    run()
