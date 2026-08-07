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
#: Yıkıcı testlerin koşabileceği bilinen veritabanı adları.
#:
#: ⚠️ `ceyhandb` (geliştirme veritabanı) 30 Tem 2026'da bu listeden **ÇIKARILDI**.
#: Sebep somut: entegrasyon testleri geliştirme kataloğuna 1841 ürün biriktirdi
#: ve bir mutasyon provası (denetim işine enjekte edilen `UPDATE products SET
#: stock = 0` + commit) **gerçek katalog ürünlerinin stoğunu sıfırladı**. Test
#: kodunun canlı geliştirme verisine yazabilmesi, er ya da geç o veriyi bozar.
#:
#: Artık kural: veritabanı adı `test` İÇERMEK ZORUNDA (ya da
#: `INTEGRATION_TEST_DB_ALLOW` ile açıkça izin verilmiş olmalı). Tek kullanımlık
#: veritabanı `tests/integration/conftest.py` tarafından yoksa oluşturulur ve
#: `alembic upgrade head` ile hazırlanır.
SAFE_DB_NAMES = {"postgres_test", "adana_test", "adana_verify"}


class UnsafeTestDatabase(RuntimeError):
    """Yıkıcı testler güvenli olmayan bir veritabanına yönlendirilmiş."""


def _allowed_extra() -> set[str]:
    raw = os.getenv("INTEGRATION_TEST_DB_ALLOW", "")
    return {x.strip().lower() for x in raw.split(",") if x.strip()}


def _is_test_name(db: str) -> bool:
    """Ad tek kullanımlık bir test veritabanına mı benziyor?"""
    return "test" in db or db in SAFE_DB_NAMES or db in _allowed_extra()


async def purge_products(session, product_ids) -> int:
    """Test ürünlerini defter satırlarıyla birlikte **fiziksel** siler.

    Neden ayrı bir yardımcı: `stock_movements` append-only'dir ve DELETE bir
    trigger'la reddedilir; ürün FK'si de `RESTRICT`. Bu yüzden testler ürünü
    soft-delete etmek zorunda kalıyordu ve satırlar birikiyordu (1841 ürün).
    Burada trigger YALNIZ test veritabanında ve yalnız bu işlem için geçici
    olarak devre dışı bırakılır — üretimde bu fonksiyon `assert_test_database`
    tarafından zaten reddedilir.
    """
    from sqlalchemy import text

    assert_test_database()
    ids = [int(i) for i in product_ids or []]
    if not ids:
        return 0
    # F29: sayım/hasar kayıtları ürüne `RESTRICT` ile bağlıdır ve iz tabloları
    # da append-only'dir. Sıra önemli: olay → satır → oturum → defter → ürün.
    await session.execute(
        text("ALTER TABLE stock_count_line_events DISABLE TRIGGER USER")
    )
    await session.execute(text("ALTER TABLE stock_damage_events DISABLE TRIGGER USER"))
    try:
        await session.execute(
            text(
                "DELETE FROM stock_count_line_events WHERE line_id IN "
                "(SELECT id FROM stock_count_lines WHERE product_id = ANY(:i))"
            ),
            {"i": ids},
        )
        await session.execute(
            text("DELETE FROM stock_damage_events WHERE product_id = ANY(:i)"),
            {"i": ids},
        )
    finally:
        await session.execute(
            text("ALTER TABLE stock_count_line_events ENABLE TRIGGER USER")
        )
        await session.execute(
            text("ALTER TABLE stock_damage_events ENABLE TRIGGER USER")
        )
    oturumlar = (
        await session.execute(
            text(
                "SELECT DISTINCT session_id FROM stock_count_lines "
                "WHERE product_id = ANY(:i)"
            ),
            {"i": ids},
        )
    ).scalars().all()
    await session.execute(
        text("DELETE FROM stock_count_lines WHERE product_id = ANY(:i)"), {"i": ids}
    )
    if oturumlar:
        # Yalnız BU ürünlerden ibaret kalan (artık satırı olmayan) oturumlar.
        await session.execute(
            text(
                "DELETE FROM stock_count_sessions s WHERE s.id = ANY(:o) "
                "AND NOT EXISTS (SELECT 1 FROM stock_count_lines l "
                "WHERE l.session_id = s.id)"
            ),
            {"o": list(oturumlar)},
        )
    # Envanter audit izleri: hedef satır silindiyse kayıt YETİM kalır ve
    # `audit_logs` sessizce şişer (bir F29 koşumunda 619 satır birikti). Yalnız
    # hedefi artık var olmayan satırlar silinir — başka testin izine dokunulmaz.
    for hedef, tablo in (
        ("stock_count_session", "stock_count_sessions"),
        ("stock_damage_event", "stock_damage_events"),
    ):
        await session.execute(
            text(
                "DELETE FROM audit_logs WHERE target_type = :t "
                f"AND NOT EXISTS (SELECT 1 FROM {tablo} x "
                "WHERE x.id = audit_logs.target_id)"
            ),
            {"t": hedef},
        )
    await session.execute(text("ALTER TABLE stock_movements DISABLE TRIGGER USER"))
    try:
        await session.execute(
            text("DELETE FROM stock_movements WHERE product_id = ANY(:i)"), {"i": ids}
        )
    finally:
        await session.execute(text("ALTER TABLE stock_movements ENABLE TRIGGER USER"))
    await session.execute(
        text("ALTER TABLE products DISABLE TRIGGER USER")
    )
    try:
        await session.execute(text("DELETE FROM products WHERE id = ANY(:i)"), {"i": ids})
    finally:
        await session.execute(text("ALTER TABLE products ENABLE TRIGGER USER"))
    await session.commit()
    return len(ids)


async def purge_packages(session, package_ids) -> int:
    """VERİLEN paketleri olay iziyle birlikte **fiziksel** siler.

    Neden ayrı bir yardımcı (F29 `purge_products` ile aynı gerekçe):
    `package_scan_events` append-only'dir — UPDATE/DELETE bir trigger'la
    reddedilir — ve `package_id` FK'si `RESTRICT`'tir. Yani paketleme testleri
    kendi satırlarını normal yoldan temizleyemez; temizleyemedikleri satırlar
    hijyen nöbetçisini kırar.

    Trigger YALNIZ test veritabanında ve yalnız bu işlem için geçici olarak
    kapatılır — üretimde bu fonksiyon `assert_test_database` tarafından zaten
    reddedilir.

    **Kapsam paket kimliğiyle sınırlıdır.** Tabloların tamamını boşaltmak,
    aynı anda koşan başka bir testin izini de silerdi; o test kendi verisini
    bulamadığında hata "flaky" görünür ve sebebi aylarca bulunamaz.
    """
    from sqlalchemy import text

    assert_test_database()
    ids = [int(i) for i in package_ids or []]
    if not ids:
        return 0
    await session.execute(text("ALTER TABLE package_scan_events DISABLE TRIGGER USER"))
    try:
        await session.execute(
            text("DELETE FROM package_scan_events WHERE package_id = ANY(:i)"),
            {"i": ids},
        )
    finally:
        await session.execute(
            text("ALTER TABLE package_scan_events ENABLE TRIGGER USER")
        )
    await session.execute(
        text("DELETE FROM order_package_items WHERE package_id = ANY(:i)"), {"i": ids}
    )
    await session.execute(
        text("DELETE FROM order_packages WHERE id = ANY(:i)"), {"i": ids}
    )
    await session.commit()
    return len(ids)


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


class RealPaymentProviderInTests(RuntimeError):
    """Testler GERÇEK bir ödeme sağlayıcısına yönlendirilmiş."""


#: Test koşumunda ASLA seçilemeyecek sağlayıcılar (gerçek ağ isteği atanlar).
#: Allowlist yerine denylist bilinçli: yeni bir SAHTE sağlayıcı eklendiğinde
#: (ör. gecikme taklidi yapan bir stub) suite kendiliğinden koşabilmelidir;
#: yeni bir GERÇEK sağlayıcı ise buraya eklenmeden kullanılamaz — ve o ekleme
#: bilinçli bir karardır, unutulan bir satır değil.
REAL_PAYMENT_PROVIDERS = frozenset({"iyzico"})


def assert_fake_payment_provider(provider: str | None = None) -> None:
    """Testler gerçek bir ödeme sağlayıcısıyla koşamaz (TB-21).

    ## Neden gerekli

    Kök `conftest.py` `PAYMENT_PROVIDER=fake` varsayılanını koyar, ama
    `setdefault` yalnız değişken YOKKEN korur. Açıkça `iyzico` verilmiş bir
    koşum (ör. eski bir betik, yanlış kopyalanmış bir CI adımı) yine gerçek
    sandbox'a çıkardı.

    Üç zarar: (1) **yalancı kırmızı** — kod doğruyken test düşer ve gerçek
    regresyonla karıştırılır; (2) **dış bağımlılık** — testler ağa ve üçüncü
    taraf sandbox'ının çalışmasına bağlanır (kök `CLAUDE.md` §G); (3) en
    sinsisi: istek BAŞARILI olursa test yeşil kalır ve fake sağlayıcı yolunun
    hiç sınanmadığı fark edilmez.

    Bu yüzden şüphede SKIP değil **HATA** verilir: ağa çıkan bir testin
    sessizce geçmesi, düşmesinden daha tehlikelidir.
    """
    secilen = (
        provider if provider is not None else settings.PAYMENT_PROVIDER or ""
    ).strip().lower()
    if secilen in REAL_PAYMENT_PROVIDERS:
        raise RealPaymentProviderInTests(
            f"TB-21: PAYMENT_PROVIDER={secilen!r} ile entegrasyon testleri "
            "koşamaz — bu ayar testleri GERÇEK ödeme sağlayıcısının "
            "sandbox'ına çıkarır. Koşumdan önce PAYMENT_PROVIDER'ı kaldırın "
            "(kök conftest 'fake'e sabitler) ya da açıkça 'fake' verin."
        )
