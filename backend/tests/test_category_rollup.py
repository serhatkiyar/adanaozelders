"""Kategori sayaçları alt kategorilerden yukarı toplanır (ekspertiz P0-26).

Canlı hata: ürünler YAPRAK kategorilere atanıyor (seed_kitapsec.py "YKS
Kitapları"na yazar) ama mağaza gezinmesi ÜST kategoriden başlıyordu
("Sınav Kitapları"). Sayaç toplanmadığı ve filtre tam eşitlik kullandığı için
mağazanın birincil gezinme yolu 0 ürün gösteriyordu.
"""
from __future__ import annotations

from services.store_service import rollup_category_counts


def test_yaprak_sayilari_uste_toplanir() -> None:
    # 56 (kök) → 57, 58 ; ürünler yalnız yapraklarda
    parents = {56: None, 57: 56, 58: 56}
    counts = rollup_category_counts([(57, 5), (58, 1)], parents)
    assert counts[57] == 5
    assert counts[58] == 1
    assert counts[56] == 6  # üst kategori artık görünür


def test_uc_seviye_de_toplanir() -> None:
    """Model bugün iki seviyeli; üçüncü eklenirse sessizce bozulmasın."""
    parents = {1: None, 2: 1, 3: 2}
    counts = rollup_category_counts([(3, 4)], parents)
    assert counts == {3: 4, 2: 4, 1: 4}


def test_ust_kategorideki_kendi_urunleri_de_sayilir() -> None:
    """Bir kategori hem üst hem ürün taşıyıcı olabilir (ör. "Kitap")."""
    parents = {1: None, 2: 1}
    counts = rollup_category_counts([(1, 3), (2, 2)], parents)
    assert counts[2] == 2
    assert counts[1] == 5  # kendi 3'ü + çocuğun 2'si


def test_kategorisiz_urunler_yok_sayilir() -> None:
    counts = rollup_category_counts([(None, 9), (2, 1)], {1: None, 2: 1})
    assert counts == {2: 1, 1: 1}


def test_bos_girdi() -> None:
    assert rollup_category_counts([], {1: None}) == {}


def test_bilinmeyen_ust_kategori_cokertmez() -> None:
    """Silinmiş bir üst kategoriye bağlı yaprak (parents'ta yok) sayımı bozmaz."""
    counts = rollup_category_counts([(7, 2)], {7: 99})
    assert counts[7] == 2
    assert counts[99] == 2  # ata bilinmese de zincir orada durur


def test_dongu_sonsuz_donmez() -> None:
    """Bozuk veri (a→b→a) sayaç hesabını kilitlememeli."""
    parents = {1: 2, 2: 1}
    counts = rollup_category_counts([(1, 3)], parents)
    assert counts == {1: 3, 2: 3}


def test_kardes_kategoriler_birbirine_karismaz() -> None:
    parents = {1: None, 2: 1, 10: None, 11: 10}
    counts = rollup_category_counts([(2, 4), (11, 7)], parents)
    assert counts[1] == 4
    assert counts[10] == 7
