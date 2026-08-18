"""Kategori varsayılan KDV mirası — saf çözümleyici (DB'siz, Faz 4).

Karar: alt kategorinin `default_tax_rate`'i NULL ise ata zincirinden miras
ALIR (yaprağa en yakın dolu değer kazanır). Gerekçe:
  * Mali müşavir oranı kırılımın KÖKÜNE verir ("Sınav Kitapları", "Kırtasiye");
    yaprak başına elle kopya, yeni yaprak açıldığında unutulur ve sessiz
    boşluk üretir.
  * Ezme serbestliği kaybolmaz: yaprakta dolu değer varsa o kazanır ve ürün
    seviyesindeki `tax_rate` zaten mutlak otoritedir (ön-doldurma yalnız form
    kolaylığıdır, sunucu hiçbir oranı kendiliğinden TÜRETMEZ).

MUTLAK KURAL: bu dosyada GERÇEK bir KDV oranı yazılamaz. Aşağıdaki sabitler
mali müşavir onayı beklendiği için bilinçli olarak gerçek dışıdır.
"""
from __future__ import annotations

from decimal import Decimal

from services.store_service import inherited_default_tax_rate

# TEST DEĞERLERİ — gerçek KDV oranı DEĞİLDİR (mali müşavir onayı bekleniyor).
TEST_ORAN_KOK = Decimal("0.1234")
TEST_ORAN_YAPRAK = Decimal("0.4321")

#: kategori id → üst id (kök için None)
PARENTS = {1: None, 2: 1, 3: 2, 4: None}


def test_yaprak_null_ise_kokten_miras_alir():
    rates = {1: TEST_ORAN_KOK, 2: None, 3: None}
    assert inherited_default_tax_rate(3, PARENTS, rates) == TEST_ORAN_KOK


def test_yapraga_en_yakin_dolu_deger_kazanir():
    rates = {1: TEST_ORAN_KOK, 2: TEST_ORAN_YAPRAK, 3: None}
    assert inherited_default_tax_rate(3, PARENTS, rates) == TEST_ORAN_YAPRAK


def test_kendi_degeri_doluysa_zincire_bakilmaz():
    rates = {1: TEST_ORAN_KOK, 2: None, 3: TEST_ORAN_YAPRAK}
    assert inherited_default_tax_rate(3, PARENTS, rates) == TEST_ORAN_YAPRAK


def test_zincir_tamamen_null_ise_none():
    """Varsayılanı olmayan ağaçta miras UYDURULMAZ — bugünkü davranış birebir
    korunur (ön-doldurma yapılmaz, admin oranı elle girer)."""
    rates = {1: None, 2: None, 3: None}
    assert inherited_default_tax_rate(3, PARENTS, rates) is None


def test_bagimsiz_kok_kendi_basina():
    rates = {4: None}
    assert inherited_default_tax_rate(4, PARENTS, rates) is None
    assert inherited_default_tax_rate(4, PARENTS, {4: TEST_ORAN_KOK}) == TEST_ORAN_KOK


def test_parent_dongusunde_sonsuza_girmez():
    dongulu = {1: 2, 2: 1}
    assert inherited_default_tax_rate(1, dongulu, {1: None, 2: None}) is None
