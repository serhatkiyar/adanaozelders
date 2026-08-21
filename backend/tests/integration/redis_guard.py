"""Yıkıcı entegrasyon testleri için **Redis** güvenlik kilidi ([[TB-28]]).

## Neden gerekli — Postgres'te öğrenildi, Redis'te unutuldu

`db_guard.py` 30 Tem 2026'da yazıldı: entegrasyon testleri geliştirme
kataloğuna 1841 ürün biriktirmiş ve bir mutasyon provası **gerçek katalog
ürünlerinin stoğunu sıfırlamıştı**. Ders tek cümleydi: *test kodunun canlı
geliştirme verisine yazabilmesi, er ya da geç o veriyi bozar.*

Redis için aynı kapı hiç kurulmadı. `REDIS_URL` varsayılanı
`redis://localhost:6379/0`, yani `.env`'de ayrıca ayarlanmamış her koşum
geliştirme Redis'ine yazar. Oradaki veri "yalnız önbellek" değildir:

* `presence:*` — kimin çevrimiçi göründüğü,
* `rl:*` — kullanıcı bazlı rate-limit sayaçları (test 60 istek atarsa gerçek
  kullanıcı 429 yiyebilir),
* denylist — `/auth/logout` ile iptal edilmiş token'lar (silinmesi iptal
  edilmiş bir oturumu GERİ AÇAR),
* `courier:pos:*` — kurye son konumu.

Yani yanlış veritabanına yazan bir test, güvenlik ve operasyon davranışını
sessizce değiştirebilir.

## Kural

Postgres'inkiyle **aynı sertlikte**: db0 reddedilir, ret **hata** ile olur
(skip değil — sessiz atlama, korumanın hiç olmadığı hâlle aynı sonucu verir).
İzin verilen numaralar ortam değişkeniyle genişletilebilir ama bu AÇIKÇA
yapılır:

    INTEGRATION_TEST_REDIS_ALLOW=5,6
"""
from __future__ import annotations

import os
from urllib.parse import urlparse

from core.config import settings

#: Yıkıcı testlerin kullanabileceği Redis veritabanı numaraları.
#: 0 bilinçli olarak DIŞARIDADIR: geliştirme/üretim varsayılanı odur.
SAFE_REDIS_DBS = {9, 10, 11, 12, 13, 14, 15}


class UnsafeTestRedis(RuntimeError):
    """Yıkıcı testler güvenli olmayan bir Redis veritabanına yönlendirilmiş."""


def _allowed_extra() -> set[int]:
    raw = os.getenv("INTEGRATION_TEST_REDIS_ALLOW", "")
    out: set[int] = set()
    for parca in raw.split(","):
        parca = parca.strip()
        if parca.isdigit():
            out.add(int(parca))
    return out


def redis_db_of(url: str) -> int:
    """URL'deki veritabanı numarası. Yol yoksa Redis varsayılanı **0**'dır."""
    yol = urlparse(url).path.strip("/")
    return int(yol) if yol.isdigit() else 0


def assert_test_redis(url: str | None = None) -> None:
    """Bağlantı test-güvenli değilse **hata** ver.

    `db_guard.assert_test_database` ile aynı sözleşme: şüphe hâlinde skip
    değil, sert ret.
    """
    if settings.ENVIRONMENT == "production":
        raise UnsafeTestRedis(
            "Üretim ortamında yıkıcı test koşulamaz (ENVIRONMENT=production)"
        )
    hedef = url if url is not None else settings.REDIS_URL
    db = redis_db_of(hedef)
    if db in SAFE_REDIS_DBS | _allowed_extra():
        return
    raise UnsafeTestRedis(
        f"Redis veritabanı {db} yıkıcı testler için güvenli değil "
        f"(URL: {hedef}). Geliştirme verisiyle aynı veritabanına yazmak "
        f"presence, rate-limit sayaçları ve token denylist'ini bozar. "
        f"İzinli: {sorted(SAFE_REDIS_DBS)} — ya da "
        f"INTEGRATION_TEST_REDIS_ALLOW ile açıkça genişletin."
    )
