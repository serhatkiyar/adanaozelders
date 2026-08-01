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


# ══════════════════ Commit 3 denetiminden gelen matris (P2-E) ═══════════════
#
# Denetim, yaşam döngüsünün üç kritik çiftinin hiç yarıştırılmadığını buldu.
# Hepsinin ortak riski aynı: iki yol AYNI paket satırına yazıyor ve biri
# diğerinin durum kararını bayat okursa paket iki yerde birden sayılır
# (rafta + araçta). Aşağıdaki üç düğüm kayıp güncellemeyi, çift olayı ve
# izinsiz son durumu birlikte ölçer.


async def _paket_durumu(servis, paket_id: int) -> str:
    async with AsyncSessionLocal() as s:
        return (await servis.get_package(s, paket_id)).status


async def _olay_sayisi(paket_id: int, event_type: str) -> int:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(
                text(
                    "SELECT count(*) FROM package_scan_events "
                    "WHERE package_id = :p AND event_type = :e"
                ),
                {"p": paket_id, "e": event_type},
            )
        ).scalar_one()


async def _return_pending_paket(fab, servis, aid: int, kurye: int):
    """(order_id, paket, run_id) — kuryede kalmış (`RETURN_PENDING`) paket."""
    from services import delivery_service

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
        tur = await delivery_service.add_stops(s, run, [oid])
    stop_id = [d for d in tur.stops if d.order_id == oid][0].id
    async with AsyncSessionLocal() as s:
        await delivery_service.handover_scan(
            s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}"
        )
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run)
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(
            s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK"
        )
    return oid, paket, run


@pytest.mark.asyncio
async def test_ES_ZAMANLI_scan_ile_finalize_KAYIP_GUNCELLEME_URETMEZ(fab):
    """2 beklenen / 1 taranmış pakette `scan` ile `complete` çarpışır.

    İzin verilen son durumlar YALNIZ ikisi:
      * `complete` önce kazandı → eksik kalem var → 409; sonra tarama geçti →
        (`OPEN`, 2)
      * `scan` önce kazandı → satır tamamlandı → (`PACKED`, 2)

    Yasak olan: `scanned_qty == 1` (tarama kayboldu) ya da `PACKED` iken
    `scanned_qty < expected` (eksik paket kapandı). İkisi de sessizce eksik
    paket sevkiyatı demektir.
    """
    servis = _servis()
    for _tur in range(TURLAR):
        aid = await fab.admin()
        pid, _sku, ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 2)])
        async with AsyncSessionLocal() as s:
            paket = await servis.open_package(s, oid, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)

        gorevler = [
            _gorev(lambda s: servis.scan(s, paket.id, code=ean, admin_id=aid)),
            _gorev(lambda s: servis.complete(s, paket.id, admin_id=aid)),
        ]
        if _tur % 2:
            gorevler.reverse()
        _kilit_hatasi_yok(await asyncio.gather(*gorevler, return_exceptions=True))

        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)
        assert taze.items[0].scanned_qty == 2, f"tur {_tur}: tarama kayboldu"
        assert taze.status in ("OPEN", "PACKED"), f"tur {_tur}: {taze.status}"
        if taze.status == "PACKED":
            assert taze.packed_at is not None
            assert await fab.prepared_at(oid) is not None
        else:
            assert await fab.prepared_at(oid) is None
        assert await _olay_sayisi(paket.id, "SCAN") == 2
        assert await _olay_sayisi(paket.id, "COMPLETE") <= 1


@pytest.mark.asyncio
async def test_ES_ZAMANLI_return_in_ile_repack_SIRA_ATLATMAZ(fab):
    """`RETURN_PENDING` pakette `return_in` ile `repack` çarpışır.

    Sıra atlanamaz (§3.5): paket geri geldiği OKUTULARAK doğrulanmadan yeniden
    dağıtıma verilemez. Bu yüzden izin verilen son durumlar:
      * `repack` önce → 409 (`RETURNED` bekleniyordu); sonra `return_in` →
        `RETURNED`
      * `return_in` önce → `RETURNED`; sonra `repack` → `PACKED`

    Yasak: `PACKED` iken `returned_at IS NULL` — bu, hiç okutulmamış bir
    paketin dağıtıma geri konması demektir.
    """
    servis = _servis()
    for _tur in range(TURLAR):
        aid = await fab.admin()
        kurye = await fab.kurye()
        oid, paket, _run = await _return_pending_paket(fab, servis, aid, kurye)
        assert await _paket_durumu(servis, paket.id) == "RETURN_PENDING"

        gorevler = [
            _gorev(lambda s: servis.return_in(s, paket.id, admin_id=aid)),
            _gorev(lambda s: servis.repack(s, paket.id, admin_id=aid)),
        ]
        if _tur % 2:
            gorevler.reverse()
        _kilit_hatasi_yok(await asyncio.gather(*gorevler, return_exceptions=True))

        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)
        assert taze.status in ("RETURNED", "PACKED"), f"tur {_tur}: {taze.status}"
        assert taze.returned_at is not None, "okutulmadan dağıtıma dönmüş"
        assert await _olay_sayisi(paket.id, "RETURN_IN") == 1
        if taze.status == "PACKED":
            assert await _olay_sayisi(paket.id, "REPACK") == 1
            assert await fab.prepared_at(oid) is not None
        else:
            assert await _olay_sayisi(paket.id, "REPACK") == 0
            assert await fab.prepared_at(oid) is None


@pytest.mark.asyncio
async def test_ES_ZAMANLI_return_in_ile_void_TEK_KAZANAN(fab):
    """`RETURN_PENDING` pakette `return_in` ile `void` çarpışır.

    `void` araçtaki paketten YAPILAMAZ (`from_statuses` = OPEN/PACKED/RETURNED):
    envanterin araçtaki paketi "yok" sayması, kaybolan paketi görünmez yapardı.
    İzin verilen son durumlar:
      * `void` önce → 409; sonra `return_in` → `RETURNED`
      * `return_in` önce → `RETURNED`; sonra `void` → `VOID` (artık depoda)

    Yasak: `VOID` iken `returned_at IS NULL` (araçtaki paket yok sayıldı).
    """
    servis = _servis()
    for _tur in range(TURLAR):
        aid = await fab.admin()
        kurye = await fab.kurye()
        _oid, paket, _run = await _return_pending_paket(fab, servis, aid, kurye)

        gorevler = [
            _gorev(lambda s: servis.return_in(s, paket.id, admin_id=aid)),
            _gorev(
                lambda s: servis.void(
                    s, paket.id, admin_id=aid, reason="Sipariş iptal edildi"
                )
            ),
        ]
        if _tur % 2:
            gorevler.reverse()
        _kilit_hatasi_yok(await asyncio.gather(*gorevler, return_exceptions=True))

        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)
        assert taze.status in ("RETURNED", "VOID"), f"tur {_tur}: {taze.status}"
        assert taze.returned_at is not None, "araçtaki paket yok sayıldı"
        assert await _olay_sayisi(paket.id, "RETURN_IN") == 1
        if taze.status == "VOID":
            assert taze.void_reason, "gerekçesiz VOID"
            assert await _olay_sayisi(paket.id, "VOID") == 1
        else:
            assert await _olay_sayisi(paket.id, "VOID") == 0


@pytest.mark.asyncio
async def test_ES_ZAMANLI_zimmet_ile_void_TEK_KAZANAN(fab):
    """Kurye paketi okuturken depo aynı anda paketi bozmaya kalkar.

    Bu, F30'un en pahalı yarışıdır: kaybeden taraf sessiz kalırsa paket hem
    araçta hem "çözülmüş" olur. İzin verilen son durumlar:
      * zimmet önce → `HANDED_OVER` + sipariş `SHIPPED`; `void` 409
      * `void` önce → `VOID` + sipariş `PAID` + `prepared_at` NULL; zimmet 409

    Yasak: `VOID` iken siparişin `SHIPPED` olması (yok edilmiş paketin
    dağıtımda sayılması) ya da iki `SHIPPED` geçişi.
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
        async with AsyncSessionLocal() as s:
            paket = await servis.complete(s, paket.id, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await delivery_service.add_stops(s, run, [oid])

        gorevler = [
            _gorev(
                lambda s: delivery_service.handover_scan(
                    s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}"
                )
            ),
            _gorev(
                lambda s: servis.void(s, paket.id, admin_id=aid, reason="Kutu ezildi")
            ),
        ]
        if _tur % 2:
            gorevler.reverse()
        _kilit_hatasi_yok(await asyncio.gather(*gorevler, return_exceptions=True))

        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)
        siparis_durumu, _odeme = await fab.siparis_durumu(oid)
        gecis = await _shipped_gecisi(oid)

        assert taze.status in ("HANDED_OVER", "VOID"), f"tur {_tur}: {taze.status}"
        if taze.status == "HANDED_OVER":
            assert siparis_durumu == "SHIPPED"
            assert gecis == 1
        else:
            assert siparis_durumu == "PAID", "yok edilmiş paket dağıtımda"
            assert gecis == 0
            assert await fab.prepared_at(oid) is None


async def _shipped_gecisi(order_id: int) -> int:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(
                text(
                    "SELECT count(*) FROM order_status_history "
                    "WHERE order_id = :o AND new_status = 'SHIPPED'"
                ),
                {"o": order_id},
            )
        ).scalar_one()
