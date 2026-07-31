"""F30 eşzamanlılık — GERÇEK PostgreSQL yarışları.

Desen `test_inventory_apply_race_pg.py`'den devralındı ve gerekçesi aynıdır:

* her görev KENDİ session'ında, başında `SET LOCAL lock_timeout` → kilit sırası
  hatası testi ASKIDA BIRAKMAZ, kırar;
* `asyncio.gather(..., return_exceptions=True)` sonuçları taranır — beklenen iş
  kuralı hataları dışında her istisna yeniden yükseltilir, yoksa "görev hiç
  çalışmadı" sessizce yutulur;
* her çift TERS başlatma sırasıyla ve birden çok tur koşar.

Tümü F30 yazılana kadar KIRMIZIDIR.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.database import AsyncSessionLocal
from tests.integration.f30_factory import PaketFabrikasi

TURLAR = 3
KILIT_ZAMAN_ASIMI = "4s"


def _servis():
    try:
        from services import packing_service
    except ImportError as exc:  # noqa: PERF203
        pytest.fail(
            f"HENÜZ YAZILMADI: services/packing_service.py ({exc})", pytrace=False
        )
    return packing_service


def _beklenen_mi(exc: BaseException) -> bool:
    """İş kuralı reddi mi (409/404/422), yoksa gerçek bir hata mı?"""
    return isinstance(exc, HTTPException) and exc.status_code in (404, 409, 422)


def _kilit_hatasi_yok(sonuclar) -> None:
    for r in sonuclar:
        if not isinstance(r, BaseException):
            continue
        kod = getattr(getattr(r, "orig", None), "sqlstate", None) or ""
        if kod == "40P01":
            pytest.fail(f"DEADLOCK (40P01): {r}")
        if kod == "55P03":
            pytest.fail(f"KİLİT ZAMAN AŞIMI (55P03) — kilit sırası bozuk: {r}")
        if not _beklenen_mi(r):
            raise r


@pytest.fixture
async def fab(pg) -> PaketFabrikasi:
    f = PaketFabrikasi()
    yield f
    await f.temizle()


async def _oturum():
    s = AsyncSessionLocal()
    await s.execute(text(f"SET LOCAL lock_timeout = '{KILIT_ZAMAN_ASIMI}'"))
    return s


async def _gorev(fn):
    s = await _oturum()
    try:
        return await fn(s)
    finally:
        await s.close()


# ══════════════════ Paket açma yarışı ═══════════════════════════════════════


@pytest.mark.asyncio
async def test_IKI_OPERATOR_ayni_siparisi_ayni_anda_PAKETLEYEMEZ(fab):
    """Kullanıcı maddesi: iki operatör aynı siparişi eşzamanlı paketleyemez.

    Otorite `uq_order_packages_live` kısmi unique index'idir; uygulama katmanı
    yarışı kaybederse IntegrityError'a düşer ve mevcut paketi döner. Sonuçta
    DB'de **tek** paket kalır.
    """
    servis = _servis()
    for _tur in range(TURLAR):
        aid = await fab.admin()
        pid, _sku, _ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])

        sonuclar = await asyncio.gather(
            _gorev(lambda s: servis.open_package(s, oid, admin_id=aid)),
            _gorev(lambda s: servis.open_package(s, oid, admin_id=aid)),
            return_exceptions=True,
        )
        _kilit_hatasi_yok(sonuclar)

        async with AsyncSessionLocal() as s:
            adet = (
                await s.execute(
                    text("SELECT count(*) FROM order_packages WHERE order_id = :o"),
                    {"o": oid},
                )
            ).scalar_one()
        assert adet == 1, f"tur {_tur}: {adet} paket oluştu"


# ══════════════════ Tarama yarışı ═══════════════════════════════════════════


@pytest.mark.asyncio
async def test_ES_ZAMANLI_iki_tarama_TAVANI_ASAMAZ(fab):
    """Beklenen 1 olan satıra iki paralel tarama gelirse toplam 1 olmalı.

    `scanned_qty <= expected_qty` CHECK'i son sözü söyler; uygulama katmanı
    satırı `FOR UPDATE` ile almazsa okuma-değiştirme-yazma yarışı 2 yazardı.
    """
    servis = _servis()
    for _tur in range(TURLAR):
        aid = await fab.admin()
        pid, _sku, ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
        async with AsyncSessionLocal() as s:
            paket = await servis.open_package(s, oid, admin_id=aid)

        sonuclar = await asyncio.gather(
            _gorev(lambda s: servis.scan(s, paket.id, code=ean, admin_id=aid)),
            _gorev(lambda s: servis.scan(s, paket.id, code=ean, admin_id=aid)),
            return_exceptions=True,
        )
        _kilit_hatasi_yok(sonuclar)

        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)
        assert taze.items[0].scanned_qty == 1, f"tur {_tur}: tavan aşıldı"


@pytest.mark.asyncio
async def test_ES_ZAMANLI_ayni_idempotency_key_TEK_KEZ_sayar(fab):
    """Ağ tekrarı iki isteği aynı anda getirebilir; kısmi unique index
    (`uq_package_scan_idem`) ikinciyi düşürür ve adet 1 kalır."""
    servis = _servis()
    for _tur in range(TURLAR):
        aid = await fab.admin()
        pid, _sku, ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 2)])
        async with AsyncSessionLocal() as s:
            paket = await servis.open_package(s, oid, admin_id=aid)

        sonuclar = await asyncio.gather(
            _gorev(
                lambda s: servis.scan(
                    s, paket.id, code=ean, admin_id=aid, idempotency_key="ayni"
                )
            ),
            _gorev(
                lambda s: servis.scan(
                    s, paket.id, code=ean, admin_id=aid, idempotency_key="ayni"
                )
            ),
            return_exceptions=True,
        )
        _kilit_hatasi_yok(sonuclar)

        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)
        assert taze.items[0].scanned_qty == 1, f"tur {_tur}: idempotency tutmadı"


# ══════════════════ Tamamlama yarışı ════════════════════════════════════════


@pytest.mark.asyncio
async def test_ES_ZAMANLI_complete_TEK_DAMGA_uretir(fab):
    """İki operatör aynı anda "Tamamla"ya basarsa tek `packed_at` yazılır ve
    `prepared_at` bir kez damgalanır."""
    servis = _servis()
    for _tur in range(TURLAR):
        aid = await fab.admin()
        pid, _sku, ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
        async with AsyncSessionLocal() as s:
            paket = await servis.open_package(s, oid, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)

        sonuclar = await asyncio.gather(
            _gorev(lambda s: servis.complete(s, paket.id, admin_id=aid)),
            _gorev(lambda s: servis.complete(s, paket.id, admin_id=aid)),
            return_exceptions=True,
        )
        _kilit_hatasi_yok(sonuclar)

        async with AsyncSessionLocal() as s:
            damgalar = (
                await s.execute(
                    text("SELECT packed_at FROM order_packages WHERE id = :p"),
                    {"p": paket.id},
                )
            ).scalars().all()
        assert len(damgalar) == 1 and damgalar[0] is not None


# ══════════════════ Zimmet yarışı ═══════════════════════════════════════════


@pytest.mark.asyncio
async def test_ES_ZAMANLI_zimmet_TEK_SHIPPED_uretir(fab):
    """Kurye QR'ı iki kez okutursa (ya da çift dokunma olursa) sipariş bir kez
    dağıtıma çıkar; ikinci geçiş `order_status_history`'de görünmemeli."""
    servis = _servis()
    from services import delivery_service

    zimmet = getattr(delivery_service, "handover_scan", None)
    if zimmet is None:
        pytest.fail("HENÜZ YAZILMADI: delivery_service.handover_scan", pytrace=False)

    for _tur in range(TURLAR):
        aid = await fab.admin()
        kurye = await fab.kurye()
        run = await fab.tur(courier_id=kurye)
        pid, _sku, ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
        async with AsyncSessionLocal() as s:
            paket = await servis.open_package(s, oid, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)
        async with AsyncSessionLocal() as s:
            paket = await servis.complete(s, paket.id, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await delivery_service.add_stops(s, run, [oid])

        sonuclar = await asyncio.gather(
            _gorev(
                lambda s: zimmet(
                    s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}"
                )
            ),
            _gorev(
                lambda s: zimmet(
                    s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}"
                )
            ),
            return_exceptions=True,
        )
        _kilit_hatasi_yok(sonuclar)

        async with AsyncSessionLocal() as s:
            gecis = (
                await s.execute(
                    text(
                        "SELECT count(*) FROM order_status_history "
                        "WHERE order_id = :o AND new_status = 'SHIPPED'"
                    ),
                    {"o": oid},
                )
            ).scalar_one()
        assert gecis == 1, f"tur {_tur}: {gecis} adet SHIPPED geçişi"


# ══════════════════ Kilit sırası ════════════════════════════════════════════


@pytest.mark.asyncio
async def test_PAKETLEME_ile_IPTAL_yarisi_TUTARSIZ_DURUM_BIRAKMAZ(fab):
    """Paket tamamlanırken sipariş iptal edilirse: ya paket PACKED ve sipariş
    PAID kalır, ya sipariş CANCELLED ve paket VOID olur. **Aradaki hâl yasak**:
    iptal edilmiş sipariş `prepared_at` damgalı kalamaz (dağıtıma girerdi).

    Kanonik kilit sırası (`Order → OrderPackage`) her iki yönde de aynı olduğu
    için deadlock beklenmez; `lock_timeout` bunu ölçer.
    """
    servis = _servis()
    from models.store import Order
    from services import order_fsm

    async def _iptal(s):
        siparis = await s.get(Order, oid, with_for_update=True)
        await order_fsm.transition_order(
            s, siparis, "CANCELLED", changed_by="admin", reason="yarış testi"
        )
        await s.commit()

    for _tur in range(TURLAR):
        aid = await fab.admin()
        pid, _sku, ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
        async with AsyncSessionLocal() as s:
            paket = await servis.open_package(s, oid, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)

        gorevler = [
            _gorev(lambda s: servis.complete(s, paket.id, admin_id=aid)),
            _gorev(_iptal),
        ]
        if _tur % 2:                       # ters başlatma sırası
            gorevler.reverse()
        _kilit_hatasi_yok(await asyncio.gather(*gorevler, return_exceptions=True))

        siparis_durumu, _odeme = await fab.siparis_durumu(oid)
        async with AsyncSessionLocal() as s:
            paket_taze = await servis.get_package(s, paket.id)
        hazir = await fab.prepared_at(oid)

        if siparis_durumu == "CANCELLED":
            assert paket_taze.status == "VOID", "iptal edilen siparişin paketi canlı"
            assert hazir is None, "iptal edilen sipariş hazır damgalı kaldı"
        else:
            assert siparis_durumu == "PAID"
            assert paket_taze.status == "PACKED"


@pytest.mark.asyncio
async def test_kilit_sirasi_DEADLOCK_URETMEZ(fab):
    """Aynı sipariş üstünde paketleme ve dağıtım akışları çarpışır.

    Paketleme `Order → OrderPackage`, dağıtım `Order → DeliveryStop` alır.
    Kanonik sıra (`… → Order → OrderPackage → DeliveryStop`) korunduğu sürece
    döngü doğmaz. `mark_prepared`'ın kilitsiz deseni (G7) kopyalanırsa bu test
    55P03 ile kırılır.
    """
    servis = _servis()
    from services import delivery_service

    for _tur in range(TURLAR):
        aid = await fab.admin()
        kurye = await fab.kurye()
        run = await fab.tur(courier_id=kurye)
        pid, _sku, ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
        async with AsyncSessionLocal() as s:
            paket = await servis.open_package(s, oid, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)

        gorevler = [
            _gorev(lambda s: servis.complete(s, paket.id, admin_id=aid)),
            _gorev(lambda s: delivery_service.add_stops(s, run, [oid])),
        ]
        if _tur % 2:
            gorevler.reverse()
        _kilit_hatasi_yok(await asyncio.gather(*gorevler, return_exceptions=True))
