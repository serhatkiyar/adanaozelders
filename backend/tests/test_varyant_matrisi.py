"""Varyant matrisi: kartezyen çarpım + ikiz koruması (saf mantık).

Kombinasyon üretimi DB'siz karar verilebilir ve iki sessiz kusur sınıfı taşır:

  1. **İkiz varyant.** `uq_products_variant_combo` TAM eşitliğe bakar; "Kırmızı"
     ve "kırmızı" iki ayrı satır olur ve vitrinde iki ayrı şık görünür.
  2. **Var olanı yeniden üretme.** Mevcut varyantla eşleşmeyen bir hücre yeni
     sayılırsa üretim IntegrityError'a düşer ya da (harf farkıyla) ikiz doğar.

Her iki kusur da üretimden önce görünmez; bu yüzden nöbetli.
"""
from __future__ import annotations

from services.variant_service import matris_hucreleri


def test_iki_eksen_kartezyen_carpim_uretir() -> None:
    hucreler = matris_hucreleri(["Kırmızı", "Mavi"], ["S", "M", "L"], {})
    assert len(hucreler) == 6
    assert hucreler[0] == {
        "option1_value": "Kırmızı",
        "option2_value": "S",
        "mevcut_urun_id": None,
    }
    # Eksen1 dış, eksen2 iç döngü: yöneticinin yazdığı sırayla okunur.
    assert [(h["option1_value"], h["option2_value"]) for h in hucreler] == [
        ("Kırmızı", "S"),
        ("Kırmızı", "M"),
        ("Kırmızı", "L"),
        ("Mavi", "S"),
        ("Mavi", "M"),
        ("Mavi", "L"),
    ]


def test_tek_eksende_ikinci_deger_none_kalir() -> None:
    hucreler = matris_hucreleri(["70g", "80g"], None, {})
    assert len(hucreler) == 2
    assert all(h["option2_value"] is None for h in hucreler)


def test_bos_eksen2_listesi_tek_eksen_gibi_davranir() -> None:
    assert len(matris_hucreleri(["A"], [], {})) == 1


def test_buyuk_kucuk_harf_ikizi_elenir() -> None:
    hucreler = matris_hucreleri(["Kırmızı", "kırmızı", "KIRMIZI"], None, {})
    assert len(hucreler) == 1
    assert hucreler[0]["option1_value"] == "Kırmızı", "ilk yazım korunmalı"


def test_turkce_noktasiz_I_ikizi_elenir() -> None:
    """Python'un `casefold`'u Türkçeyi bilmez ve bu ikizi KAÇIRIR.

    `"KIRMIZI".casefold()` → `"kirmizi"`, `"Kırmızı".casefold()` → `"kırmızı"`.
    Eşdeğerlik `normalize_tr`den (DB'deki `tr_normalize` ile aynı eşleme)
    gelmezse büyük harfle yazan yönetici sessizce ikiz varyant üretir.
    """
    assert "KIRMIZI".casefold() != "Kırmızı".casefold(), "provanın dayanağı"
    hucreler = matris_hucreleri(["Kırmızı", "KIRMIZI"], None, {})
    assert len(hucreler) == 1


def test_diakritik_ikizi_elenir() -> None:
    hucreler = matris_hucreleri(["Sarı", "Sari"], None, {})
    assert len(hucreler) == 1


def test_bosluklar_kirpilir_bos_degerler_atilir() -> None:
    hucreler = matris_hucreleri(["  Mavi  ", "", "   "], None, {})
    assert [h["option1_value"] for h in hucreler] == ["Mavi"]


def test_mevcut_varyant_isaretlenir() -> None:
    mevcut = {("Kırmızı", "S"): 101}
    hucreler = matris_hucreleri(["Kırmızı", "Mavi"], ["S"], mevcut)
    esleme = {(h["option1_value"], h["option2_value"]): h["mevcut_urun_id"] for h in hucreler}
    assert esleme[("Kırmızı", "S")] == 101
    assert esleme[("Mavi", "S")] is None


def test_mevcut_eslesmesi_harf_duyarsizdir() -> None:
    """Yönetici 'kırmızı' yazdı diye 'Kırmızı'nın ikizi ÜRETİLMEMELİ."""
    mevcut = {("Kırmızı", "S"): 101}
    hucreler = matris_hucreleri(["kırmızı"], ["s"], mevcut)
    assert hucreler[0]["mevcut_urun_id"] == 101


def test_tek_eksende_none_anahtari_eslesir() -> None:
    mevcut = {("70g", None): 55}
    hucreler = matris_hucreleri(["70g", "80g"], None, mevcut)
    assert hucreler[0]["mevcut_urun_id"] == 55
    assert hucreler[1]["mevcut_urun_id"] is None


def test_tumu_bos_ise_hucre_uretilmez() -> None:
    assert matris_hucreleri(["", "  "], None, {}) == []
