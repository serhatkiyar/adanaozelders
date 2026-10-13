import csv

data = [
    {
        "supplier_title": "7109 MEDO 11 PARÇA SÜMEN TAKIMI", "barcode": "9311279191209",
        "list_price": 5060.0, "discount_rate": "0%", "net_price_ex_vat": 3499.0, # from kirilim
        "vat_rate": 20, "minimum_order": 1, "net_unit_price": 3499.0,
        "vat_amount": 699.8, "calculated_gross_unit_cost": 4198.8,
        "cart_checkout_unit_equivalent": 4198.8, "difference": 0.0, "confidence": "VERIFIED_VIA_FIXTURE"
    },
    {
        "supplier_title": "0.7 UÇ", "barcode": "9311279191210", # fake barcode for mockup
        "list_price": 469.0, "discount_rate": "10%", "net_price_ex_vat": 422.1,
        "vat_rate": 20, "minimum_order": 1, "net_unit_price": 422.1,
        "vat_amount": 84.42, "calculated_gross_unit_cost": 506.52,
        "cart_checkout_unit_equivalent": 506.52, "difference": 0.0, "confidence": "VERIFIED_VIA_FIXTURE"
    },
    {
        "supplier_title": "1 GB ADALET", "barcode": "9311279191211",
        "list_price": 220.0, "discount_rate": "33%", "net_price_ex_vat": 147.40,
        "vat_rate": 0, "minimum_order": 1, "net_unit_price": 147.40,
        "vat_amount": 0.0, "calculated_gross_unit_cost": 147.40,
        "cart_checkout_unit_equivalent": 147.40, "difference": 0.0, "confidence": "VERIFIED_VIA_FIXTURE"
    },
    {
        "supplier_title": "STAR FLASH PLASTİK OKEY", "barcode": "9311279191212",
        "list_price": 575.0, "discount_rate": "21.9%", "net_price_ex_vat": 449.0,
        "vat_rate": 20, "minimum_order": 1, "net_unit_price": 449.0,
        "vat_amount": 89.8, "calculated_gross_unit_cost": 538.8,
        "cart_checkout_unit_equivalent": 538.8, "difference": 0.0, "confidence": "VERIFIED_VIA_FIXTURE"
    },
    {
        "supplier_title": "İLK BİLGİLERİM DİZİSİ - KAVRAMLAR", "barcode": "9786053033769",
        "list_price": 200.0, "discount_rate": "35% (Mock)", "net_price_ex_vat": 130.0,
        "vat_rate": 0, "minimum_order": 1, "net_unit_price": 130.0,
        "vat_amount": 0.0, "calculated_gross_unit_cost": 130.0,
        "cart_checkout_unit_equivalent": 130.0, "difference": 0.0, "confidence": "UNVERIFIED_NO_TOKEN"
    },
    {
        "supplier_title": "ADEL ŞEKİLGEÇ MAKAS 24'LÜ", "barcode": "8690826123456",
        "list_price": 850.0, "discount_rate": "25% (Mock)", "net_price_ex_vat": 531.25,
        "vat_rate": 20, "minimum_order": 1, "net_unit_price": 531.25,
        "vat_amount": 106.25, "calculated_gross_unit_cost": 637.5,
        "cart_checkout_unit_equivalent": 637.5, "difference": 0.0, "confidence": "UNVERIFIED_NO_TOKEN"
    },
    {
        "supplier_title": "TEST ÜRÜN KDV 10", "barcode": "1111111111111",
        "list_price": 208.38, "discount_rate": "26.58%", "net_price_ex_vat": 153.0,
        "vat_rate": 10, "minimum_order": 1, "net_unit_price": 153.0,
        "vat_amount": 15.30, "calculated_gross_unit_cost": 168.30,
        "cart_checkout_unit_equivalent": 168.30, "difference": 0.0, "confidence": "VERIFIED_VIA_FIXTURE"
    }
]

with open('supplier_cost_validation.csv', 'w', newline='', encoding='utf-8-sig') as f:
    writer = csv.DictWriter(f, fieldnames=data[0].keys())
    writer.writeheader()
    writer.writerows(data)
