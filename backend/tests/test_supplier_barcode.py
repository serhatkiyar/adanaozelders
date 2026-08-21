"""GS1 barkod doğrulaması — SAF.

Rapor §2.7 bu konuda somut bir uyarı içeriyor: keşif sırasında **yalnız EAN-13
kabul eden** bir doğrulama kullanıldı ve iki yönde birden yanıldı — 72 geçerli
ITF-14'ü reddetti, 77 checksum hatalısını kabul etti. Katalog dağılımı:
EAN-13 11.640 · ITF-14 72 · UPC-A 21 · EAN-8 6 · bozuk 99 · yok 77.

Doğrulama otomatik eşleştirmenin kapısıdır: bozuk bir barkodla kurulan bağ,
YANLIŞ ürünün stoğunu vitrine yazar. Bu yüzden burada checksum gerçekten
hesaplanır, uzunluk kontrolü yeterli sayılmaz.
"""
from __future__ import annotations

import pytest

from core.suppliers.barcode import normalize_barcode, validate_barcode

# Checksum'ları elle doğrulanmış örnekler.
GECERLI = [
    ("8691217932103", "EAN-13"),
    ("8695894110038", "EAN-13"),
    ("9786052856475", "EAN-13"),   # ISBN-13 (kitap)
    ("18695894110035", "ITF-14"),  # aynı gövde, düzine ambalajı
    ("28695894110032", "ITF-14"),  # aynı gövde, koli
    ("036000291452", "UPC-A"),
    ("96385074", "EAN-8"),
]

BOZUK = [
    "8694051010124",   # son hane değiştirilmiş EAN-13
    "8691217932104",   # son hane değiştirilmiş EAN-13
    "18695894110036",  # son hane değiştirilmiş ITF-14
    "036000291453",    # son hane değiştirilmiş UPC-A
    "96385075",        # son hane değiştirilmiş EAN-8
]


@pytest.mark.parametrize("kod, tip", GECERLI)
def test_gecerli_barkodlar_kabul_edilir(kod, tip):
    sonuc = validate_barcode(kod)
    assert sonuc.valid is True, f"{kod} ({tip}) geçerli olmalıydı"
    assert sonuc.kind == tip


@pytest.mark.parametrize("kod", BOZUK)
def test_checksum_hatasi_yakalanir(kod):
    """Uzunluk doğru ama kontrol hanesi yanlış. Yalnız `len()` bakan bir
    doğrulama bunların HEPSİNİ kabul ederdi."""
    assert validate_barcode(kod).valid is False


def test_itf14_yalniz_uzunluga_bakarak_reddedilmez():
    """Raporun düzeltilen hatası: 72 geçerli ITF-14 "13 hane değil" diye
    eleniyordu."""
    assert validate_barcode("18695894110035").valid is True


@pytest.mark.parametrize(
    "kod",
    ["", "   ", None, "ABC123", "12345", "123456789012345678", "869589411003X"],
)
def test_bicimsiz_girdiler_reddedilir(kod):
    assert validate_barcode(kod).valid is False


def test_sifir_onekli_14_hane_ean13e_indirgenir():
    """Rapor §2.7: `14 hane, "0" ön ekli ve kalanı geçerli EAN-13 → ön eki at`.
    Bazı sistemler EAN-13'ü 14 haneye sıfırla doldurur; bu bir ITF-14 değildir."""
    sonuc = validate_barcode("08691217932103")
    assert sonuc.valid is True
    assert sonuc.normalized == "8691217932103"
    assert sonuc.kind == "EAN-13"


def test_normalize_bosluk_ve_tireleri_atar():
    assert normalize_barcode("  869-1217 932103 ") == "8691217932103"
    assert normalize_barcode(None) is None
    assert normalize_barcode("") is None


def test_normalize_gercek_veriyi_bozmaz():
    assert normalize_barcode("8691217932103") == "8691217932103"


def test_ayni_govdenin_farkli_ambalaj_seviyeleri_ayri_kodlardir():
    """ÇINAR 11003 örneği (rapor §2.7): üçünün de checksum'ı geçerli, gövdeleri
    aynı. Bunlar AYNI ürünün tekil/düzine/koli barkodlarıdır — eşleştirmede
    birbirinin yerine geçemezler, çünkü stok ve fiyat farklı birimdedir."""
    kodlar = ["8695894110038", "18695894110035", "28695894110032"]
    assert all(validate_barcode(k).valid for k in kodlar)
    normalize = {validate_barcode(k).normalized for k in kodlar}
    assert len(normalize) == 3, "farklı ambalaj seviyeleri tek koda indirgenmemeli"
