"""Eğitmen analiz zaman serisi — saf kova (bucket) mantığı.

`series_buckets` hiçbir DB/IO yapmaz; tek sorumluluğu seçili dönemi
(`windows()` ile aynı `cur` aralığı) ara boşluksuz, çakışmasız kovalara
bölmek. Bu testler yalnız o geometriyi doğrular — DB'ye bağlı toplamlar
(lessons/earnings) `tests/integration` kapsamındadır.
"""
from __future__ import annotations

import datetime

import pytest

from services.tutor_analytics_service import PERIODS, series_buckets, windows

NOW = datetime.datetime(2026, 9, 19, 12, 0, tzinfo=datetime.timezone.utc)


@pytest.mark.parametrize(
    ("period", "beklenen_kova_sayisi"),
    [("week", 7), ("month", 30), ("quarter", 13)],
)
def test_kova_sayisi(period, beklenen_kova_sayisi):
    assert len(series_buckets(NOW, period)) == beklenen_kova_sayisi


@pytest.mark.parametrize("period", list(PERIODS))
def test_kovalar_ara_bosluksuz_ve_cakismasiz(period):
    buckets = series_buckets(NOW, period)
    for (_, onceki_bitis), (sonraki_baslangic, _) in zip(buckets, buckets[1:], strict=False):
        assert onceki_bitis == sonraki_baslangic


@pytest.mark.parametrize("period", list(PERIODS))
def test_kovalar_secili_donem_penceresini_tam_dosiyor(period):
    """Kovaların ilk başlangıcı ve son bitişi `windows()`'un `cur` aralığıyla birebir örtüşmeli."""
    buckets = series_buckets(NOW, period)
    cur, _prev = windows(NOW, PERIODS[period])
    assert buckets[0][0] == cur[0]
    assert buckets[-1][1] == cur[1] == NOW


def test_quarter_kalan_gunler_en_eski_kovaya_eklenir():
    """90 // 7 = 12 kalan 6 gün → en eski kova 6 gün, geri kalan 12 kova 7'şer gün."""
    buckets = series_buckets(NOW, "quarter")
    genislikler = [(bitis - baslangic).days for baslangic, bitis in buckets]
    assert genislikler[0] == 6
    assert genislikler[1:] == [7] * 12
