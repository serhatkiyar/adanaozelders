import re

def calculate_ean13_checksum(ean: str) -> str:
    """Calculates the check digit for an EAN-13 or UPC-12 (padded)."""
    # Pad to 13 digits if 12 (UPC)
    if len(ean) == 12:
        ean = "0" + ean
        
    if len(ean) != 13:
        return ""
        
    # sum = sum(odd_indices) * 1 + sum(even_indices) * 3 (0-indexed, reverse logic for some)
    # Actually EAN-13: position 1, 3, 5... (0-idx 0, 2, 4) * 1, pos 2, 4, 6... (0-idx 1, 3, 5) * 3
    total = 0
    for i in range(12):
        if i % 2 == 0:
            total += int(ean[i]) * 1
        else:
            total += int(ean[i]) * 3
            
    rem = total % 10
    check = 0 if rem == 0 else 10 - rem
    return str(check)

def calculate_isbn10_checksum(isbn: str) -> str:
    if len(isbn) != 10:
        return ""
    total = 0
    for i in range(9):
        total += int(isbn[i]) * (10 - i)
    rem = total % 11
    check = (11 - rem) % 11
    return "X" if check == 10 else str(check)

def normalize_identifier(identifier: str) -> tuple[str, str, bool]:
    """
    Cleans up ISBN/EAN/UPC barcodes and validates check digits.
    Returns (normalized_identifier, identifier_type, is_valid).
    """
    if not identifier:
        return "", "", False
        
    cleaned = re.sub(r'[^0-9X]', '', str(identifier).upper())
    
    if len(cleaned) == 13:
        is_valid = cleaned[-1] == calculate_ean13_checksum(cleaned)
        # Amazon Catalog API returns 13-digit ISBNs (978/979) under the 'EAN' identifierType,
        # and automatically converts them to 10-digit ISBNs under the 'ISBN' identifierType.
        # To maintain exact string matching with our source data, we MUST treat 13-digit codes as 'EAN'.
        return cleaned, "EAN", is_valid
        
    elif len(cleaned) == 12:
        # UPC-A
        padded = "0" + cleaned
        is_valid = padded[-1] == calculate_ean13_checksum(padded)
        return cleaned, "UPC", is_valid
        
    elif len(cleaned) == 10:
        is_valid = cleaned[-1] == calculate_isbn10_checksum(cleaned)
        return cleaned, "ISBN", is_valid
        
    return cleaned, "INVALID", False
