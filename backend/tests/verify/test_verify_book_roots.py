"""BOOK_ROOT_SLUGS ↔ canlı katalog hizası (SALT OKUNUR doğrulama).

`variant_service.BOOK_ROOT_SLUGS` kod tarafında bir sözlüktür; kategori ağacı
ise admin elindedir. Kökler yeniden adlandırılır ya da silinirse "kitapta
varyant kapalı" kuralı hiçbir kategoriyle eşleşmez ve SESSİZCE devre dışı
kalır (yalancı yeşilin en sinsi hâli: kod doğru, veri kaymış).

İki katmanlı koruma:
  1. Servis kapısı: kitap kökü kategorisi admin ucundan silinemez /
     yeniden adlandırılamaz (`store_service` — PG testi var).
  2. BU TEST: yapılandırılmış (gerçek) veritabanındaki kategori ağacında üç
     kökün AKTİF kayıt olarak var olduğunu doğrular — kapıyı atlayan her yol
     (ham SQL, seed, geri yükleme) burada yakalanır.

`tests/verify/` sözleşmesi gereği canlı altyapıya karşı koşar ve HİÇBİR ŞEY
YAZMAZ; DB erişilemiyorsa SKIP (CI_REQUIRE_SERVICES=1 iken hata).
"""
from __future__ import annotations

import pytest
from sqlalchemy import exc as sa_exc
from sqlalchemy import select, text

from core.database import AsyncSessionLocal, engine
from models.store import ProductCategory
from services.variant_service import BOOK_ROOT_SLUGS
from tests.service_guard import servis_yok

_BAGLANTI_HATALARI = (
    ConnectionError,
    OSError,
    sa_exc.OperationalError,
    sa_exc.InterfaceError,
    sa_exc.DBAPIError,
)


async def test_kitap_kokleri_canli_katalogda_aktif():
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except _BAGLANTI_HATALARI as exc:
        servis_yok("Postgres", exc)

    # `finally` ZORUNLU: aşağıdaki `pytest.skip` de bir exception'dır ve
    # `engine.dispose()` eskiden bu bloğun ALTINDA düz bir satırdı — yani boş
    # katalogda (CI'nın taze `adana_verify` veritabanı tam olarak böyledir)
    # hiç çalışmıyordu. `async with` bağlantıyı havuza İADE eder, kapatmaz;
    # test bitince pytest-asyncio o event loop'u kapatır ve havuzda ölü loop'a
    # bağlı canlı bir bağlantı kalır. Sıradaki dosya (alfabetik:
    # test_verify_booking_money.py) onu alıp `RuntimeError: got Future
    # attached to a different loop` ile ERROR veriyordu — 21 Ağu 2026'da CI'da
    # ölçüldü. Havuzun boşaltılması ÇIKIŞ YOLUNA BAĞLI OLAMAZ.
    try:
        async with AsyncSessionLocal() as s:
            # Katalog hiç kurulmamışsa (boş/tek kullanımlık DB) hizalanacak veri
            # yoktur — bu bir sapma değil, kapsam dışıdır.
            toplam = (
                await s.execute(
                    select(ProductCategory.id).where(
                        ProductCategory.deleted_at.is_(None)
                    )
                )
            ).scalars().first()
            if toplam is None:
                pytest.skip("kategori kataloğu boş — hizalanacak canlı veri yok")

            mevcut = set(
                (
                    await s.execute(
                        select(ProductCategory.slug).where(
                            ProductCategory.slug.in_(sorted(BOOK_ROOT_SLUGS)),
                            ProductCategory.deleted_at.is_(None),
                        )
                    )
                ).scalars()
            )
    finally:
        await engine.dispose()
    eksik = BOOK_ROOT_SLUGS - mevcut
    assert not eksik, (
        f"Kitap kökü slug'ları katalogda YOK: {sorted(eksik)}. Kategori "
        "yeniden düzenlendiyse variant_service.BOOK_ROOT_SLUGS güncellenmeli — "
        "aksi hâlde kitapta-varyant-kapalı kuralı sessizce devre dışı."
    )
