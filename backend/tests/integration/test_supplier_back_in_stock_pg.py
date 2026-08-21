"""Tedarikçi stoğu gelince "stoğa girdi" bildirimi gider — gerçek PG.

## Neden bu kararı verdik

`StockNotification` aboneleri "bu ürünü SATIN ALABİLECEĞİM zaman haber ver"
diyor; "rafınıza mal girdiğinde" demiyorlar. Tedarikçiden temin açıkken ürün
gerçekten satın alınabilir hâle gelir — bildirim göndermemek, aboneyi
vitrindeki "Sepete ekle" düğmesini görmemiş bırakmaktır.

Karşı taraf da düşünüldü: temin KAPALIYKEN bildirim atmak yanlış olurdu, çünkü
o ürün hâlâ satılamaz. Bu yüzden tetik `supplier_backed` ile kapılıdır.

`notified_at` damgası tek-seferliği garanti eder: 60 saniyelik döngü, damga
olmasa aboneye her turda posta atardı.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from core.suppliers.fake import FakeSupplierClient
from services import supplier_sync_service
from tests.integration.supplier_factory import GECERLI_BARKODLAR, Fabrika
from tests.integration.test_supplier_sync_pg import _fav


@pytest.fixture
async def fab(pg):
    f = Fabrika()
    yield f
    await f.temizle()


@pytest.fixture
def posta(monkeypatch):
    """Gerçekten gönderilen postaları yakalar (console sender'a inmeden)."""
    from core import mail

    kayit: list[dict] = []

    async def sahte(*, to: str, product_title: str, product_url: str) -> None:
        kayit.append({"to": to, "title": product_title, "url": product_url})

    monkeypatch.setattr(mail, "send_back_in_stock_email", sahte)
    # `store_service` modülü `mail`'i modül olarak import ediyor; aynı nesne.
    return kayit


async def _abone(product_id: int, email: str) -> None:
    from models.store import StockNotification

    async with AsyncSessionLocal() as s:
        s.add(StockNotification(product_id=product_id, email=email))
        await s.commit()


async def _senkron(supplier_id: int, client) -> None:
    from models.supplier import Supplier

    async with AsyncSessionLocal() as s:
        sup = await s.get(Supplier, supplier_id)
        await supplier_sync_service.sync_stock(s, sup, client)


async def test_tedarikci_stogu_gelince_abonelere_haber_verilir(fab, posta):
    kod = GECERLI_BARKODLAR[0]
    sid = await fab.tedarikci()
    pid = await fab.urun(stock=0, supplier_backed=True, barcode=kod)
    await fab.tedarikci_urunu(
        sid, external_id=1001, barcode=kod, product_id=pid, link_source="AUTO",
        stock_qty="0",
    )
    await _abone(pid, "abone@test.local")

    await _senkron(sid, FakeSupplierClient(favorites=[_fav(1001, barcode=kod, stock="4")]))

    assert [p["to"] for p in posta] == ["abone@test.local"]


async def test_temin_kapaliysa_haber_verilmez(fab, posta):
    """Ürün hâlâ satılamıyor; "stoğa girdi" demek yanlış vaattir."""
    kod = GECERLI_BARKODLAR[1]
    sid = await fab.tedarikci()
    pid = await fab.urun(stock=0, supplier_backed=False, barcode=kod)
    await fab.tedarikci_urunu(
        sid, external_id=1001, barcode=kod, product_id=pid, link_source="AUTO",
        stock_qty="0",
    )
    await _abone(pid, "abone@test.local")

    await _senkron(sid, FakeSupplierClient(favorites=[_fav(1001, barcode=kod, stock="4")]))

    assert posta == []


async def test_zaten_stoktaysa_tekrar_haber_verilmez(fab, posta):
    """Geçiş `<1 → >=1` olmalı. 4'ten 9'a çıkmak bir "geri geldi" olayı değildir."""
    kod = GECERLI_BARKODLAR[0]
    sid = await fab.tedarikci()
    pid = await fab.urun(stock=0, supplier_backed=True, barcode=kod)
    await fab.tedarikci_urunu(
        sid, external_id=1001, barcode=kod, product_id=pid, link_source="AUTO",
        stock_qty="4",
    )
    await _abone(pid, "abone@test.local")

    await _senkron(sid, FakeSupplierClient(favorites=[_fav(1001, barcode=kod, stock="9")]))

    assert posta == []


async def test_kendi_stogu_varken_tedarikci_hareketi_haber_uretmez(fab, posta):
    """Ürün zaten satılabilirdi; abone bildirim beklemiyor."""
    kod = GECERLI_BARKODLAR[0]
    sid = await fab.tedarikci()
    pid = await fab.urun(stock=3, supplier_backed=True, barcode=kod)
    await fab.tedarikci_urunu(
        sid, external_id=1001, barcode=kod, product_id=pid, link_source="AUTO",
        stock_qty="0",
    )
    await _abone(pid, "abone@test.local")

    await _senkron(sid, FakeSupplierClient(favorites=[_fav(1001, barcode=kod, stock="7")]))

    assert posta == []


async def test_bildirim_tek_sefer_gonderilir(fab, posta):
    """60 sn'lik döngüde damga olmasa abone günde 1440 posta alırdı."""
    kod = GECERLI_BARKODLAR[0]
    sid = await fab.tedarikci()
    pid = await fab.urun(stock=0, supplier_backed=True, barcode=kod)
    await fab.tedarikci_urunu(
        sid, external_id=1001, barcode=kod, product_id=pid, link_source="AUTO",
        stock_qty="0",
    )
    await _abone(pid, "abone@test.local")

    for _ in range(3):
        await _senkron(
            sid, FakeSupplierClient(favorites=[_fav(1001, barcode=kod, stock="4")])
        )

    assert len(posta) == 1

    async with AsyncSessionLocal() as s:
        damga = (
            await s.execute(
                text(
                    "SELECT notified_at FROM stock_notifications WHERE product_id = :i"
                ),
                {"i": pid},
            )
        ).scalar_one()
    assert damga is not None
