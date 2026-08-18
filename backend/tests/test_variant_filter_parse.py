"""`parse_variant_filters` — saf birim testleri (DB'siz).

Bağımsız denetim P2-6(d): docstring "pytest'li" diyordu ama test yoktu.
Fonksiyonun sözleşmesi: "Eksen:Değer" öğelerini {eksen: [değerler]}'e çevirir;
biçimsiz öğe SESSİZCE YUTULMAZ — ValueError yükseltilir (router 400'e çevirir,
davranışı `test_variant_public_pg.py::test_bicimsiz_variant_parametresi_400`).
"""
from __future__ import annotations

import pytest

from services.store_service import parse_variant_filters


def test_tek_oge():
    assert parse_variant_filters(["Renk:Sarı"]) == {"Renk": ["Sarı"]}


def test_ayni_eksenin_degerleri_birikir_eksenler_ayrisir():
    assert parse_variant_filters(["Renk:Sarı", "Renk:Pembe", "Ebat:A4"]) == {
        "Renk": ["Sarı", "Pembe"],
        "Ebat": ["A4"],
    }


def test_bosluklar_kirpilir():
    assert parse_variant_filters([" Renk : Sarı "]) == {"Renk": ["Sarı"]}


def test_degerin_icindeki_iki_nokta_korunur():
    """partition İLK ayırıcıda böler: değer ':' içerebilir (ör. oran yazımı)."""
    assert parse_variant_filters(["Ebat:21:29,7"]) == {"Ebat": ["21:29,7"]}


def test_none_ve_bos_liste_bos_sozluk():
    assert parse_variant_filters(None) == {}
    assert parse_variant_filters([]) == {}


@pytest.mark.parametrize("bozuk", ["bozuk", ":deger", "Renk:", "  :  ", ""])
def test_bicimsiz_oge_valueerror(bozuk):
    with pytest.raises(ValueError) as ei:
        parse_variant_filters([bozuk])
    assert "Eksen:Değer" in str(ei.value)


def test_bozuk_oge_gecerlilerin_arasinda_da_yakalanir():
    """Kısmi kabul yok: tek bozuk öğe bütün isteği düşürür — 'yarım filtre'
    sessizce daha geniş sonuç döndürürdü."""
    with pytest.raises(ValueError):
        parse_variant_filters(["Renk:Sarı", "bozuk"])
