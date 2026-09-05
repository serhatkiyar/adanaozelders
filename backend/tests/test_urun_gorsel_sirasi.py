"""Ürün galerisi sıralama mantığı (saf).

Sıralama DB'siz karar verilebilir bir iştir ve iki kuralı vardır: istenen dizi
0'dan numaralanır, dizide olmayanlar SİLİNMEZ — mevcut göreli sıralarını
koruyarak sona eklenir. İkinci kural sessizce bozulabilir bir sözleşmedir:
bozulduğunda iki yönetici aynı anda çalışırken yeni yüklenen görsel kaybolur.
"""
from __future__ import annotations

from services.store_service import yeni_gorsel_sirasi


def test_istenen_dizi_sifirdan_numaralanir() -> None:
    mevcut = [(10, 0), (11, 1), (12, 2)]
    assert yeni_gorsel_sirasi(mevcut, [12, 10, 11]) == {12: 0, 10: 1, 11: 2}


def test_eksik_gorsel_silinmez_sona_eklenir() -> None:
    """Yönetici sürüklerken başka biri 13'ü yüklediyse 13 kaybolmamalı."""
    mevcut = [(10, 0), (11, 1), (13, 2)]
    sira = yeni_gorsel_sirasi(mevcut, [11, 10])
    assert sira[11] == 0
    assert sira[10] == 1
    assert sira[13] == 2, "dizide geçmeyen görsel düştü"


def test_eksiklerin_kendi_arasindaki_sira_korunur() -> None:
    mevcut = [(10, 0), (20, 5), (21, 3), (22, 9)]
    sira = yeni_gorsel_sirasi(mevcut, [10])
    # 21(3) → 20(5) → 22(9) sırası korunarak 1,2,3'e yerleşir.
    assert (sira[21], sira[20], sira[22]) == (1, 2, 3)


def test_bos_istek_mevcut_sirayi_sikistirir() -> None:
    """Hiçbir şey istenmediyse sıra bozulmaz, yalnız boşluklar kapanır."""
    mevcut = [(10, 4), (11, 7), (12, 99)]
    assert yeni_gorsel_sirasi(mevcut, []) == {10: 0, 11: 1, 12: 2}


def test_sonuc_her_gorseli_tam_bir_kez_kapsar() -> None:
    mevcut = [(1, 0), (2, 1), (3, 2), (4, 3)]
    sira = yeni_gorsel_sirasi(mevcut, [3, 1])
    assert set(sira) == {1, 2, 3, 4}
    assert sorted(sira.values()) == [0, 1, 2, 3], "sıra numaraları çakıştı veya atladı"


def test_tek_gorselli_galeri() -> None:
    assert yeni_gorsel_sirasi([(9, 0)], [9]) == {9: 0}
