"""İP-21 · Faz 2 — test izolasyonu ve sessizce etkisiz kalan limiter (saf birim).

**Üretim kodundan ÖNCE yazıldı** (kök CLAUDE.md §E). Sözleşme §1/K-3, K-4.

  N-3 (TB-28)  Redis'in `db_guard` karşılığı yok. `REDIS_URL` varsayılanı
               `redis://localhost:6379/0` — yani entegrasyon testleri, hiçbir
               şey söylemeden GELİŞTİRME Redis'ine yazabiliyor. Postgres için
               bu yol 30 Tem'de kapatıldı (bir mutasyon provası gerçek katalog
               stoklarını sıfırlamıştı); Redis'te hâlâ açık.
  N-4 (TB-51)  `core.ratelimit._client` modül düzeyi singleton'dır ve ilk
               yaratıldığı event loop'a bağlanır. pytest-asyncio her teste yeni
               loop kurduğu için, suite içinde eski istemci istisna atar,
               `enforce` `except Exception → return` ile FAIL-OPEN'a düşer ve
               limiter testi SESSİZCE hiçbir şey ölçmez. Ölçüldü (İP-19,
               15 Ağu): tek başına 429, tam suite içinde 61 yazmanın 61'i 200.
"""
from __future__ import annotations

import asyncio

import pytest


# ── N-3 · TB-28: Redis guard ──────────────────────────────────────────────────


def test_N3_redis_guard_db0_i_REDDEDER():
    """🔴 Bugün böyle bir guard yok.

    Kural Postgres'inkiyle aynı sertlikte olmalı: geliştirme verisiyle aynı
    Redis veritabanına yıkıcı test koşmanın meşru hâli yoktur. Reddetme
    **skip değil hata** olur — sessiz atlama, korumanın olmadığı hâlle aynı
    sonucu verir.
    """
    from tests.integration.redis_guard import UnsafeTestRedis, assert_test_redis

    with pytest.raises(UnsafeTestRedis):
        assert_test_redis("redis://localhost:6379/0")
    with pytest.raises(UnsafeTestRedis):
        assert_test_redis("redis://localhost:6379")  # db yok = db0


def test_N3b_ayrilmis_veritabani_KABUL_EDILIR():
    """DOLULUK NÖBETÇİSİ: guard "her şeyi reddet"e dönüşemez."""
    from tests.integration.redis_guard import assert_test_redis

    assert_test_redis("redis://localhost:6379/13")
    assert_test_redis("redis://127.0.0.1:6379/9")


def test_N3c_izin_verilen_numaralar_ortamdan_genisletilebilir(monkeypatch):
    """CI başka bir numara kullanabilmeli — ama açıkça söyleyerek."""
    from tests.integration import redis_guard

    monkeypatch.setenv("INTEGRATION_TEST_REDIS_ALLOW", "5")
    assert_ = redis_guard.assert_test_redis
    assert_("redis://localhost:6379/5")
    with pytest.raises(redis_guard.UnsafeTestRedis):
        assert_("redis://localhost:6379/0")


# ── N-4 · TB-51: limiter istemcisi event loop'a bağlı ─────────────────────────


def test_N4_istemci_yeni_event_loopta_YENILENIR():
    """🔴 Bugün istemci bir kez kurulur ve ilk loop'a bağlı kalır.

    İkinci loop'ta aynı nesne döner; o nesne kapanmış loop'a bağlı olduğu için
    ilk kullanımda istisna atar ve limiter fail-open'a düşer. İddia: `_redis()`
    istemciyi hangi loop'ta kurduğunu HATIRLAR ve loop değiştiyse yeniler.

    Üretimde davranış DEĞİŞMEZ: tek uzun ömürlü loop vardır, ilk istemci
    sonsuza dek geçerlidir (N-4b bunu ölçer).
    """
    from core import ratelimit

    ratelimit._client = None

    async def _al():
        return ratelimit._redis()

    ilk = asyncio.run(_al())
    ikinci = asyncio.run(_al())

    assert ilk is not None and ikinci is not None
    assert ilk is not ikinci, (
        "yeni event loop'ta eski istemci döndü — bu istemci ilk kullanımda "
        "istisna atar ve limiter SESSİZCE fail-open olur (TB-51)"
    )


def test_N4b_ayni_loop_icinde_istemci_YENIDEN_KURULMAZ():
    """DOLULUK NÖBETÇİSİ: düzeltme "her çağrıda yeni istemci"ye dönüşemez.

    Her `enforce` çağrısında yeni bağlantı kurmak, üretimde saniyede onlarca
    TCP bağlantısı demektir — limiterin kendisi darboğaza dönerdi.
    """
    from core import ratelimit

    ratelimit._client = None

    async def _iki_kez():
        return ratelimit._redis(), ratelimit._redis()

    a, b = asyncio.run(_iki_kez())
    assert a is b, "aynı loop içinde istemci yeniden kuruldu"
