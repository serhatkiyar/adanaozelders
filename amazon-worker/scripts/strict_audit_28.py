import json
import csv
import re
import sys

# ─────────────────────────────────────────────
# Semantic Identity Check
# ─────────────────────────────────────────────
def normalize_text(text):
    if not text:
        return set()
    text = text.lower()
    # Turkish char translation
    tr = str.maketrans("ışğüöç", "isguoc")
    text = text.translate(tr)
    # keep only alphanumeric and space
    text = re.sub(r'[^a-z0-9\s]', ' ', text)
    tokens = text.split()
    # Stopwords (very aggressive for strict check)
    stop = {"ve", "ile", "icin", "adet", "li", "lu", "paket", "kutu", "renk", "cm", "mm", 
            "gr", "kg", "ml", "lt", "a", "bir", "set", "boy", "ebat", "kucuk", "buyuk", "orta",
            "sari", "kirmizi", "mavi", "yesil", "siyah", "beyaz", "pembe", "mor", "turuncu", "gri",
            "model", "tip", "orijinal", "orjinal", "yeni", "kalite"}
    return set(t for t in tokens if len(t) > 2 and t not in stop)

# We define broad generic terms that shouldn't grant TRUSTED by themselves
GENERIC_TOKENS = {"canta", "kalem", "defter", "kagit", "dosya", "kutu", "set", "oyun", "oyuncak"}

def classify_identity_strict(sup_title, amz_title, sup_brand=""):
    sup_tok = normalize_text(sup_title + " " + sup_brand)
    amz_tok = normalize_text(amz_title)
    
    if not sup_tok or not amz_tok:
        return "REVIEW"
        
    overlap = sup_tok & amz_tok
    
    # If there is no overlap at all, it's a CONFLICT
    if not overlap:
        return "CONFLICT"
        
    # If the only overlap are generic words, it requires REVIEW
    if overlap.issubset(GENERIC_TOKENS):
        return "REVIEW"
        
    # Otherwise, it has meaningful overlap, so TRUSTED
    return "TRUSTED"


def run():
    # Read the 28 recovered from the summary
    summary_file = "nonbook_notfound_verification_summary.csv"
    recovered = []
    
    try:
        with open(summary_file, "r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row["classification"] == "RECOVERED":
                    recovered.append(row)
    except Exception as e:
        print(f"Error reading summary: {e}")
        return

    # Load enriched and catalog to get brand and category if needed
    catalog = json.load(open("scan_checkpoint_catalog.json", "r", encoding="utf-8"))
    
    # Also load evidence to get exact returned identifiers
    evidence = {}
    try:
        with open("nonbook_notfound_verification_evidence.jsonl", "r", encoding="utf-8") as f:
            for line in f:
                if not line.strip(): continue
                data = json.loads(line)
                pid = str(data["supplier_product_id"])
                ident = data["identifier"]
                if pid not in evidence:
                    evidence[pid] = {}
                evidence[pid][ident] = data
    except Exception as e:
        print(f"Error reading evidence: {e}")

    results = []
    counts = {"TRUSTED": 0, "REVIEW": 0, "CONFLICT": 0}

    for row in recovered:
        pid = str(row["supplier_product_id"])
        c = catalog.get(pid, {})
        sup_brand = c.get("supplier_brand", "")
        sup_cat = c.get("supplier_category", "")
        
        sup_title = row["supplier_title"]
        amz_title = row["amazon_title"]
        matched_ident = row["matched_barcode"]
        
        # Get returned identifiers from evidence
        ev = evidence.get(pid, {}).get(matched_ident, {})
        ret_idents = ev.get("returned_identifiers", [])
        exact_match = matched_ident in ret_idents if ret_idents else False
        
        # Re-classify strictly
        new_cls = classify_identity_strict(sup_title, amz_title, sup_brand)
        counts[new_cls] += 1
        
        results.append({
            "pid": pid,
            "sup_title": sup_title,
            "sup_brand": sup_brand,
            "sup_cat": sup_cat,
            "primary_barcode": row["primary_barcode"],
            "matched_barcode": matched_ident,
            "is_primary": "PRI" if str(row["is_primary"]).lower() in ["true", "1"] else "ALT",
            "carpan": row["carpan"],
            "asin": row["asin"],
            "amz_title": amz_title,
            "ret_idents": ", ".join(ret_idents) if ret_idents else "",
            "exact_match": str(exact_match),
            "identity": new_cls,
            "old_identity": row.get("identity_classification", "")
        })

    print(f"RECOVERED_INPUT : {len(recovered)}\n")
    print(f"TRUSTED         : {counts['TRUSTED']}")
    print(f"REVIEW          : {counts['REVIEW']}")
    print(f"CONFLICT        : {counts['CONFLICT']}")
    print(f"\nSUM             : {sum(counts.values())}\n")
    
    print("=" * 160)
    # Define a clean format string
    fmt = "{:<8} | {:<30} | {:<12} | {:<12} | {:<3} | {:<2} | {:<10} | {:<30} | {:<5} | {:<8}"
    header = fmt.format("PID", "Supplier Title", "Primary BC", "Matched BC", "P/A", "Cp", "ASIN", "Amazon Title", "Exact", "Class")
    print(header)
    print("-" * 160)
    
    # Sort: CONFLICT first, then REVIEW, then TRUSTED
    sort_order = {"CONFLICT": 0, "REVIEW": 1, "TRUSTED": 2}
    results.sort(key=lambda x: sort_order[x["identity"]])
    
    for r in results:
        sup_t = r["sup_title"][:28] + ".." if len(r["sup_title"]) > 30 else r["sup_title"]
        amz_t = r["amz_title"][:28] + ".." if len(r["amz_title"]) > 30 else r["amz_title"]
        print(fmt.format(
            r["pid"], sup_t, r["primary_barcode"], r["matched_barcode"],
            r["is_primary"], r["carpan"], r["asin"], amz_t,
            "Yes" if r["exact_match"]=="True" else "No", r["identity"]
        ))
        
        # If it's CONFLICT or REVIEW, print the tokens to debug
        if r["identity"] in ["CONFLICT", "REVIEW"]:
            sup_tok = normalize_text(r["sup_title"] + " " + r["sup_brand"])
            amz_tok = normalize_text(r["amz_title"])
            print(f"   ↳ Tokens [Sup]: {sup_tok}")
            print(f"   ↳ Tokens [Amz]: {amz_tok}")
            print(f"   ↳ Overlap     : {sup_tok & amz_tok}")

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    run()
