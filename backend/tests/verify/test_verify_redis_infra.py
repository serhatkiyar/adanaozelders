"""Redis'e dayanan iki koruma — GERÇEK Redis'e karşı doğrulama.

## Neden bu dosya var

`core/ratelimit` ve `core/token_denylist` bilinçli olarak **FAIL-OPEN**'dır:
Redis'e ulaşılamazsa limiter saymaz, denylist "iptal edilmemiş" der ve istek
yine geçer. Üretimde bu doğru ödünleşme (altyapı arızası bütün girişleri
kesmesin), ama doğrulama açısından tehlikelidir — çünkü **bozuk kod ile
Redis'siz ortam aynı sonucu üretir**:

  - `enforce()` içindeki sayma mantığı tamamen silinse,
  - `revoke()` hiçbir şey yazmasa,
  - `is_revoked()` her zaman `False` dönse,

Redis'siz bir suite'te tek bir test bile kırılmazdı. Denetimde bu boşluk
kayıtlıydı: `grep` ile bakıldığında `tests/` ağacında gerçek Redis'e bağlanan
tek bir test yoktu; yani "logout token'ı iptal eder" ve "limiter sayar"
iddialarının hiçbir otomatik kanıtı yoktu.

Bu dosya o iki iddiayı gerçek Redis'e karşı **davranışla** doğrular. Redis
erişilemezse yerelde SKIP, CI'da (`CI_REQUIRE_SERVICES=1`) HATA verir —
kardeşi `test_verify_storage_access.py` ile aynı desen.
"""
from __future__ import annotations

import asyncio
import uuid

import pytest
from fastapi import HTTPException

from core import ratelimit, token_denylist
from tests.service_guard import servis_yok

pytestmark = pytest.mark.asyncio


#: Erişilemeyen bir Redis'te `ping` süresiz asılabilir; SKIP kararı hızlı olmalı.
_PING_TIMEOUT = 5


@pytest.fixture
async def redis_hazir():
    """Gerçek Redis bağlantısı; yoksa yerelde atla, CI'da kır.

    Modül düzeyinde önbelleklenen istemciler her testte SIFIRLANIR:
    pytest-asyncio her teste yeni bir event loop kurar ve redis.asyncio
    bağlantıları loop'a bağlıdır — önceki loop'un istemcisi yeniden
    kullanılırsa test asılı kalır (asyncpg tarafında aynı tuzağa düşülmüştü,
    bkz. `tests/integration/conftest.py`).
    """
    ratelimit._client = None
    token_denylist._client = None

    r = ratelimit._redis()
    if r is None:
        servis_yok("Redis", RuntimeError("istemci kurulamadı (REDIS_URL?)"))
    try:
        await asyncio.wait_for(r.ping(), timeout=_PING_TIMEOUT)
    except Exception as exc:  # noqa: BLE001
        servis_yok("Redis", exc)

    yield r

    for modul in (ratelimit, token_denylist):
        istemci, modul._client = modul._client, None
        if istemci is not None:
            await istemci.aclose()


@pytest.fixture
async def temiz_anahtarlar(redis_hazir):
    """Testin ürettiği anahtarları sonunda siler (Redis'te iz bırakmayız)."""
    anahtarlar: list[str] = []
    yield anahtarlar
    if anahtarlar:
        await redis_hazir.delete(*anahtarlar)


# ── Token denylist (logout) ────────────────────────────────────────────────────


async def test_iptal_edilen_token_gercekten_denylistte(redis_hazir, temiz_anahtarlar):
    """Logout'un asıl iddiası: iptal edilen access token bir daha kabul edilmez.

    Redis'siz ortamda `is_revoked` fail-open `False` döndüğü için bu iddia
    ancak gerçek Redis'e sorularak kanıtlanabilir.
    """
    jti = f"verify-{uuid.uuid4().hex}"
    temiz_anahtarlar.append(f"denylist:{jti}")

    assert await token_denylist.is_revoked(jti) is False, "temiz jti zaten denylistte"

    await token_denylist.revoke(jti, ttl_seconds=60)

    assert await token_denylist.is_revoked(jti) is True, (
        "iptal edilen token denylist'te görünmüyor — logout access token'ı "
        "gerçekten iptal etmiyor"
    )


async def test_denylist_kaydi_token_omru_kadar_yasiyor(redis_hazir, temiz_anahtarlar):
    """TTL yazılmazsa denylist sonsuza dek büyür (Redis'i şişirir).

    Access token kısa ömürlü olduğundan kayıt da kalan ömür kadar yaşamalı.
    """
    jti = f"verify-{uuid.uuid4().hex}"
    anahtar = f"denylist:{jti}"
    temiz_anahtarlar.append(anahtar)

    await token_denylist.revoke(jti, ttl_seconds=45)

    ttl = await redis_hazir.ttl(anahtar)
    assert 0 < ttl <= 45, f"denylist kaydında beklenen TTL yok (ttl={ttl})"


async def test_baska_kullanicinin_tokeni_etkilenmiyor(redis_hazir, temiz_anahtarlar):
    """İptal, yalnız iptal edilen jti'yi kapsar (toplu kilitlenme olmaz)."""
    iptal = f"verify-{uuid.uuid4().hex}"
    masum = f"verify-{uuid.uuid4().hex}"
    temiz_anahtarlar.append(f"denylist:{iptal}")

    await token_denylist.revoke(iptal, ttl_seconds=60)

    assert await token_denylist.is_revoked(masum) is False


# ── Rate limit (fixed-window sayaç) ────────────────────────────────────────────


async def test_limit_asilinca_429_donuyor(redis_hazir, temiz_anahtarlar):
    """Limiter GERÇEKTEN sayıyor mu?

    Redis'siz ortamda `enforce` sessizce döner; yani "login brute-force'a karşı
    korunuyor" iddiası kanıtsız kalır.
    """
    kova = f"rl:verify:{uuid.uuid4().hex}"
    temiz_anahtarlar.append(kova)

    for sira in range(1, 4):  # 1..3 serbest olmalı
        await ratelimit.enforce(bucket=kova, limit=3, window_seconds=60)
        assert await redis_hazir.get(kova) == str(sira), (
            f"{sira}. istekten sonra sayaç Redis'te beklenen değerde değil"
        )

    with pytest.raises(HTTPException) as hata:
        await ratelimit.enforce(bucket=kova, limit=3, window_seconds=60)

    assert hata.value.status_code == 429, f"limit aşıldı ama 429 yok: {hata.value}"
    assert hata.value.headers and hata.value.headers.get("Retry-After"), (
        "429 yanıtında Retry-After yok — istemci ne zaman tekrar deneyeceğini bilemez"
    )


async def test_sayac_pencere_sonunda_dusuyor(redis_hazir, temiz_anahtarlar):
    """Kovaya TTL yazılmazsa limit KALICI olur: kullanıcı bir daha giriş yapamaz."""
    kova = f"rl:verify:{uuid.uuid4().hex}"
    temiz_anahtarlar.append(kova)

    await ratelimit.enforce(bucket=kova, limit=5, window_seconds=30)

    ttl = await redis_hazir.ttl(kova)
    assert 0 < ttl <= 30, f"fixed-window kovasında TTL yok (ttl={ttl})"


async def test_kovalar_birbirinden_bagimsiz(redis_hazir, temiz_anahtarlar):
    """Bir kullanıcının limiti diğerini kilitlemez (kova anahtarı ayırıyor)."""
    a = f"rl:verify:{uuid.uuid4().hex}"
    b = f"rl:verify:{uuid.uuid4().hex}"
    temiz_anahtarlar.extend([a, b])

    for _ in range(2):
        await ratelimit.enforce(bucket=a, limit=2, window_seconds=60)
    with pytest.raises(HTTPException):
        await ratelimit.enforce(bucket=a, limit=2, window_seconds=60)

    # b kovası hâlâ serbest olmalı.
    await ratelimit.enforce(bucket=b, limit=2, window_seconds=60)
