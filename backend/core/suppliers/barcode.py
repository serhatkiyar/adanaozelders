"""GS1 barkod normalizasyonu ve checksum doğrulaması — SAF.

Neden ayrı bir modül: barkod doğrulaması **otomatik eşleştirmenin kapısıdır**.
Geçersiz bir kodla kurulan bağ, YANLIŞ ürünün stoğunu vitrine yazar ve hata
sessizdir (ürün stokta görünür, sipariş gelir, karşılanamaz).

Rapor §2.7'deki somut ders: keşifte yalnız EAN-13 kabul eden bir doğrulama
kullanıldı ve **iki yönde birden** yanıldı — 72 geçerli ITF-14 reddedildi,
77 checksum hatalısı kabul edildi. Uzunluk kontrolü doğrulama değildir.
"""
from __future__ import annotations

import dataclasses

#: Uzunluk → biçim adı. Dördü de aynı mod-10 (GS1) algoritmasını kullanır;
#: ayrım yalnız hane sayısındadır.
_UZUNLUK_TIPI = {8: "EAN-8", 12: "UPC-A", 13: "EAN-13", 14: "ITF-14"}


@dataclasses.dataclass(frozen=True, slots=True)
class BarcodeCheck:
    valid: bool
    normalized: str | None
    kind: str | None
    reason: str | None = None


def normalize_barcode(raw: str | None) -> str | None:
    """Boşluk ve tireleri atar. Boş/None → ``None``.

    Tedarikçi verisinde "869-1217 932103" gibi biçimlenmiş kodlar geliyor;
    ürün tarafındaki ISBN de tireli girilebiliyor. İki tarafı da aynı
    normalizasyondan geçirmeden eşleştirme çalışmaz.
    """
    if raw is None:
        return None
    temiz = "".join(ch for ch in str(raw) if not ch.isspace() and ch != "-")
    return temiz or None


def gs1_checksum_ok(kod: str) -> bool:
    """GS1 mod-10 kontrol hanesi doğru mu?

    Ağırlıklar SAĞDAN SOLA 3,1,3,1… (kontrol hanesi hariç). Soldan sabit bir
    ağırlıkla başlamak, tek uzunluklu biçimlerde (EAN-13) doğru, çift
    uzunluklularda (ITF-14, UPC-A) YANLIŞ sonuç verir — raporda yakalanan
    hatanın kökeni buydu.
    """
    if not kod.isdigit() or len(kod) < 8:
        return False
    haneler = [int(c) for c in kod]
    govde, kontrol = haneler[:-1], haneler[-1]
    toplam = 0
    for i, h in enumerate(govde):
        sagdan = len(govde) - 1 - i
        toplam += h * (3 if sagdan % 2 == 0 else 1)
    return (10 - (toplam % 10)) % 10 == kontrol


def validate_barcode(raw: str | None) -> BarcodeCheck:
    """Normalize eder, biçimi tanır, checksum'ı doğrular."""
    kod = normalize_barcode(raw)
    if not kod:
        return BarcodeCheck(False, None, None, "boş")
    if not kod.isdigit():
        return BarcodeCheck(False, None, None, "rakam dışı karakter")

    # "0" ön ekli 14 hane, kalanı geçerli EAN-13 ise ÖN EK ATILIR (rapor §2.7).
    # Bazı sistemler EAN-13'ü 14 haneye sıfırla doldurur; bu bir ITF-14 (koli
    # ambalajı) DEĞİLDİR ve ikisini karıştırmak farklı miktarları aynı sanmaktır.
    # Kontrol ITF-14'ten ÖNCE yapılır: sıfırla doldurulmuş kod ikisini de geçer,
    # doğru yorum tekil birimdir.
    if len(kod) == 14 and kod.startswith("0") and gs1_checksum_ok(kod[1:]):
        return BarcodeCheck(True, kod[1:], "EAN-13")
    if len(kod) == 16 and kod.startswith("0") and gs1_checksum_ok(kod[1:]):
        return BarcodeCheck(True, kod[1:], "ITF-14")

    tip = _UZUNLUK_TIPI.get(len(kod))
    if tip is None:
        return BarcodeCheck(False, None, None, f"{len(kod)} hane tanınmıyor")
    if not gs1_checksum_ok(kod):
        return BarcodeCheck(False, None, tip, "kontrol hanesi hatalı")
    return BarcodeCheck(True, kod, tip)
