"""Yıkıcı entegrasyon testleri için veritabanı güvenlik kilidi.

## Neden gerekli

`tests/integration/` altındaki testler tasarım gereği **fiziksel INSERT ve
DELETE** yapar (kendi satırlarını üretip teardown'da siler). Bir tanesi daha da
ileri gider: `test_delivery_dispatch_live_pg.py::izole_kuyruk`, dış veriden
izolasyon için **mevcut uygun siparişleri geçici bir tura park eder**. Bu, o
siparişleri `eligible_orders` kuyruğundan geçici olarak çıkarır.

Yanlış veritabanına bağlanmış bir koşu bu yüzden iki ayrı zarar üretir:
1. Üretim/geliştirme verisine satır yazmak ve silmek,
2. **Park etme yüzünden gerçek "Günü Optimize Et" akışının o siparişleri
   atlaması** — yani test, canlı operasyonu sessizce bozar.

Bu yüzden bağlantı, testler çalışmaya BAŞLAMADAN önce doğrulanır ve şüphe
hâlinde koşu **sert biçimde reddedilir** (skip değil, hata).

## Kural

- `ENVIRONMENT=production` → her hâlde ret. Üretim veritabanına karşı yıkıcı
  test koşulmasının meşru bir hâli yoktur.
- Veritabanı adı test-güvenli olmalı: adında `test` geçen adlar, bilinen
  geliştirme veritabanı (`ceyhandb`) ya da `INTEGRATION_TEST_DB_ALLOW` ile
  açıkça izin verilenler. Allowlist bilinçli olarak denylist'ten (`prod`, `live`
  gibi kelime avı) daha güvenli: bilmediğimiz bir üretim adı denylist'ten
  kaçardı, allowlist'ten kaçamaz.

Ortam değişkeni ile CI'da genişletilebilir:

    INTEGRATION_TEST_DB_ALLOW=ci_db,another_test_db
"""
from __future__ import annotations

import os

from core.config import settings

#: Yıkıcı testlerin koşabileceği bilinen veritabanı adları.
#: `ceyhandb` bu projenin geliştirme veritabanıdır ve entegrasyon testleri
#: bilinçli olarak ona karşı koşar (bkz. tests/integration/conftest.py).
SAFE_DB_NAMES = {"ceyhandb", "postgres_test", "adana_test", "adana_verify"}


class UnsafeTestDatabase(RuntimeError):
    """Yıkıcı testler güvenli olmayan bir veritabanına yönlendirilmiş."""


def _allowed_extra() -> set[str]:
    raw = os.getenv("INTEGRATION_TEST_DB_ALLOW", "")
    return {x.strip().lower() for x in raw.split(",") if x.strip()}


def assert_test_database(
    *, environment: str | None = None, database: str | None = None
) -> None:
    """Yıkıcı testler bu bağlantıya karşı koşabilir mi? Koşamazsa **yükseltir**.

    Parametreler yalnız test edilebilirlik için; varsayılan olarak canlı ayarlar
    okunur.
    """
    env = (environment if environment is not None else settings.ENVIRONMENT).strip().lower()
    db = (database if database is not None else settings.POSTGRES_DB or "").strip().lower()

    if env == "production":
        raise UnsafeTestDatabase(
            "Yıkıcı entegrasyon testleri ENVIRONMENT=production ile koşamaz. "
            "Bu testler satır yazar/siler ve dağıtım kuyruğundaki siparişleri "
            "geçici olarak park eder; üretimde canlı operasyonu bozar."
        )

    if not db:
        raise UnsafeTestDatabase(
            "POSTGRES_DB boş — hangi veritabanına bağlandığı doğrulanamıyor."
        )

    if "test" in db or db in SAFE_DB_NAMES or db in _allowed_extra():
        return

    raise UnsafeTestDatabase(
        f"Veritabanı adı {db!r} yıkıcı testler için güvenli listede değil. "
        f"Güvenli adlar: adında 'test' geçenler, {sorted(SAFE_DB_NAMES)} ya da "
        "INTEGRATION_TEST_DB_ALLOW ile açıkça izin verilenler. Yanlış bir "
        "POSTGRES_DB/DATABASE_URL ile koşmayı önlemek için bu kontrol "
        "bilinçli olarak allowlist'tir."
    )
