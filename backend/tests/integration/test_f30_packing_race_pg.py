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


def _sonuclar(sonuclar, adlar: tuple[str, ...]) -> dict:
    """`{işlem adı: sonuç ya da istisna}` — başlatma sırasından bağımsız okuma.

    Commit 4 denetiminin bulgusu: eski iddialar "son durum şu VEYA bu" diyordu
    ve **hangi işlemin kazandığına bakmıyordu**. O hâlde bir işlem sessizce
    no-op'a düşse (guard kaldırılıp ikisi de "başarılı" dönse, ya da ikisi de
    reddedilse) test yine geçerdi. Artık her düğüm önce KİMİN kazandığını
    okuyor, sonra o gözleme karşılık gelen **tek** son durumu iddia ediyor.
    """
    return dict(zip(adlar, sonuclar, strict=True))


def _reddedildi(x) -> bool:
    return isinstance(x, HTTPException) and x.status_code == 409


def _basarili(x) -> bool:
    return not isinstance(x, BaseException)


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

        adlar = ("complete", "add_stops")
        gorevler = [
            _gorev(lambda s: servis.complete(s, paket.id, admin_id=aid)),
            _gorev(lambda s: delivery_service.add_stops(s, run, [oid])),
        ]
        if _tur % 2:
            adlar, gorevler = adlar[::-1], gorevler[::-1]
        ham = await asyncio.gather(*gorevler, return_exceptions=True)
        _kilit_hatasi_yok(ham)
        r = _sonuclar(ham, adlar)

        # Deadlock yokluğu YETMEZ: geçerli son durum da doğrulanmalı, yoksa
        # iki akış da sessizce hiçbir şey yapmamış olabilir (commit 4 denetimi).
        assert _basarili(r["complete"]), f"tur {_tur}: complete düştü: {r['complete']!r}"
        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)
            durak = (
                await s.execute(
                    text(
                        "SELECT count(*) FROM delivery_stops "
                        "WHERE order_id = :o AND run_id = :r"
                    ),
                    {"o": oid, "r": run},
                )
            ).scalar_one()
        assert taze.status == "PACKED"
        assert await fab.prepared_at(oid) is not None
        if _basarili(r["add_stops"]):
            # `add_stops` ancak `complete` ondan ÖNCE bittiyse geçebilirdi
            # (hazırlanmamış sipariş tura eklenemez).
            assert durak == 1, "add_stops başarılı ama durak yok"
        else:
            assert _reddedildi(r["add_stops"]), f"beklenmeyen hata: {r['add_stops']!r}"
            assert "hazırlan" in str(r["add_stops"].detail).lower()
            assert durak == 0, "add_stops reddedildi ama durak oluşmuş"


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

        adlar = ("scan", "complete")
        gorevler = [
            _gorev(lambda s: servis.scan(s, paket.id, code=ean, admin_id=aid)),
            _gorev(lambda s: servis.complete(s, paket.id, admin_id=aid)),
        ]
        if _tur % 2:                       # ters başlatma sırası
            adlar, gorevler = adlar[::-1], gorevler[::-1]
        ham = await asyncio.gather(*gorevler, return_exceptions=True)
        _kilit_hatasi_yok(ham)
        r = _sonuclar(ham, adlar)

        # Tarama HER İKİ sırada da başarılı olmalı ve `OK` dönmeli: `OVER_QTY`
        # ya da bir istisna, taramanın sessizce yutulduğu anlamına gelirdi.
        assert _basarili(r["scan"]), f"tur {_tur}: tarama düştü: {r['scan']!r}"
        assert r["scan"].result == "OK", f"tur {_tur}: {r['scan'].result}"

        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)
        assert taze.items[0].scanned_qty == 2, f"tur {_tur}: tarama kayboldu"
        assert await _olay_sayisi(paket.id, "SCAN") == 2

        # Gözlenen sonuca göre TEK ve DAR son durum — disjonksiyon YOK.
        if _basarili(r["complete"]):
            # `complete` ancak tarama ondan ÖNCE bittiyse başarılı olabilirdi.
            assert taze.status == "PACKED"
            assert taze.packed_at is not None
            assert await fab.prepared_at(oid) is not None
            assert await _olay_sayisi(paket.id, "COMPLETE") == 1
        else:
            assert _reddedildi(r["complete"]), f"beklenmeyen hata: {r['complete']!r}"
            assert "eksik" in str(r["complete"].detail).lower()
            assert taze.status == "OPEN", "complete reddedildi ama paket kapandı"
            assert taze.packed_at is None
            assert await fab.prepared_at(oid) is None
            assert await _olay_sayisi(paket.id, "COMPLETE") == 0


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

        adlar = ("return_in", "repack")
        gorevler = [
            _gorev(lambda s: servis.return_in(s, paket.id, admin_id=aid)),
            _gorev(lambda s: servis.repack(s, paket.id, admin_id=aid)),
        ]
        if _tur % 2:
            adlar, gorevler = adlar[::-1], gorevler[::-1]
        ham = await asyncio.gather(*gorevler, return_exceptions=True)
        _kilit_hatasi_yok(ham)
        r = _sonuclar(ham, adlar)

        # `return_in` HER İKİ sırada da başarılı olmalı: paket geri gelmiştir
        # ve onu okutmayı hiçbir yarış engelleyemez.
        assert _basarili(r["return_in"]), f"tur {_tur}: {r['return_in']!r}"
        assert r["return_in"].status in ("RETURNED", "PACKED")

        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)
        assert taze.returned_at is not None, "okutulmadan dağıtıma dönmüş"
        assert await _olay_sayisi(paket.id, "RETURN_IN") == 1

        if _basarili(r["repack"]):
            # `repack` ancak `return_in` ondan ÖNCE bittiyse geçebilirdi.
            assert taze.status == "PACKED"
            assert await _olay_sayisi(paket.id, "REPACK") == 1
            assert await fab.prepared_at(oid) is not None
        else:
            assert _reddedildi(r["repack"]), f"beklenmeyen hata: {r['repack']!r}"
            assert "RETURNED" in str(r["repack"].detail)
            assert taze.status == "RETURNED", "repack reddedildi ama paket PACKED"
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

        adlar = ("return_in", "void")
        gorevler = [
            _gorev(lambda s: servis.return_in(s, paket.id, admin_id=aid)),
            _gorev(
                lambda s: servis.void(
                    s, paket.id, admin_id=aid, reason="Sipariş iptal edildi"
                )
            ),
        ]
        if _tur % 2:
            adlar, gorevler = adlar[::-1], gorevler[::-1]
        ham = await asyncio.gather(*gorevler, return_exceptions=True)
        _kilit_hatasi_yok(ham)
        r = _sonuclar(ham, adlar)

        assert _basarili(r["return_in"]), f"tur {_tur}: {r['return_in']!r}"

        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)
        assert taze.returned_at is not None, "araçtaki paket yok sayıldı"
        assert await _olay_sayisi(paket.id, "RETURN_IN") == 1

        if _basarili(r["void"]):
            assert taze.status == "VOID"
            assert taze.void_reason == "Sipariş iptal edildi"
            assert await _olay_sayisi(paket.id, "VOID") == 1
        else:
            assert _reddedildi(r["void"]), f"beklenmeyen hata: {r['void']!r}"
            assert "RETURN_PENDING" in str(r["void"].detail)
            assert taze.status == "RETURNED", "void reddedildi ama paket VOID"
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

        adlar = ("handover", "void")
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
            adlar, gorevler = adlar[::-1], gorevler[::-1]
        ham = await asyncio.gather(*gorevler, return_exceptions=True)
        _kilit_hatasi_yok(ham)
        r = _sonuclar(ham, adlar)

        # Bu çiftte iki taraf da geçemez: hangisi önce biterse öbürü YASAK bir
        # geçişe düşer. Tam bir kazanan olmalı — ikisi de "başarılı" dönerse
        # guard'lardan biri sessizce kalkmıştır.
        kazananlar = [ad for ad in adlar if _basarili(r[ad])]
        assert len(kazananlar) == 1, f"tur {_tur}: kazanan sayısı {kazananlar}"
        kayip = [ad for ad in adlar if ad not in kazananlar][0]
        assert _reddedildi(r[kayip]), f"beklenmeyen hata: {r[kayip]!r}"

        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)
        siparis_durumu, _odeme = await fab.siparis_durumu(oid)
        gecis = await _shipped_gecisi(oid)

        if kazananlar == ["handover"]:
            assert taze.status == "HANDED_OVER"
            assert taze.handed_to_courier_id == kurye
            assert siparis_durumu == "SHIPPED"
            assert gecis == 1
            assert await _olay_sayisi(paket.id, "VOID") == 0
        else:
            assert taze.status == "VOID"
            assert siparis_durumu == "PAID", "yok edilmiş paket dağıtımda"
            assert gecis == 0
            assert await fab.prepared_at(oid) is None
            assert await _olay_sayisi(paket.id, "HANDOVER") == 0


@pytest.mark.asyncio
async def test_ES_ZAMANLI_complete_ile_void_YETKI_KARARI_BAYATLAMAZ(fab):
    """TOCTOU: `complete` araya girerse pack-only kullanıcı KAPANMIŞ paketi
    void edemez (commit 4 denetimi).

    `void`in gerektirdiği izin paketin durumuna bağlıdır (`OPEN` → `pack`,
    kapanmış → `manage`). Karar **kilitsiz** okunan durumla verilseydi şu sıra
    mümkün olurdu: (1) router `OPEN` görür ve `pack` yeterli der, (2) araya
    `complete` girer ve paket `PACKED` olur, (3) `void` kapanmış paketi
    `packing.manage` OLMADAN çözer. Karar artık `Order` + `OrderPackage`
    kilitleri alındıktan sonra, taze durumla veriliyor.

    Ölçüm gerçek yetki doğrulayıcısıyla yapılır: router'ın geçirdiği
    doğrulayıcının aynısı (`durum != OPEN` → 403) servise verilir.
    """
    servis = _servis()
    for _tur in range(TURLAR):
        aid = await fab.admin()
        pid, _sku, ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
        async with AsyncSessionLocal() as s:
            paket = await servis.open_package(s, oid, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)

        async def _pack_only(durum: str) -> None:
            """`packing.pack` yetkisi olan kullanıcının doğrulayıcısı."""
            if durum != "OPEN":
                raise HTTPException(403, "packing.manage gerekir")

        adlar = ("complete", "void")
        gorevler = [
            _gorev(lambda s: servis.complete(s, paket.id, admin_id=aid)),
            _gorev(
                lambda s: servis.void(
                    s, paket.id, admin_id=aid, reason="pack-only deneme",
                    izin_dogrula=_pack_only,
                )
            ),
        ]
        if _tur % 2:
            adlar, gorevler = adlar[::-1], gorevler[::-1]
        ham = await asyncio.gather(*gorevler, return_exceptions=True)
        for x in ham:
            if isinstance(x, BaseException) and not (
                isinstance(x, HTTPException) and x.status_code in (403, 409)
            ):
                raise x

        r = _sonuclar(ham, adlar)
        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)

        if _basarili(r["complete"]):
            # `complete` kazandı → paket kapandı → pack-only void 403 ALMALI.
            assert taze.status == "PACKED", f"tur {_tur}: {taze.status}"
            assert isinstance(r["void"], HTTPException)
            assert r["void"].status_code == 403, (
                f"TOCTOU: pack-only kullanıcı kapanmış paketi çözdü ({r['void']!r})"
            )
            assert await _olay_sayisi(paket.id, "VOID") == 0
        else:
            # `void` kazandı → paket OPEN'ken çözüldü (pack yetkisi yeterliydi).
            assert _basarili(r["void"])
            assert taze.status == "VOID"
            assert _reddedildi(r["complete"])
            assert await _olay_sayisi(paket.id, "COMPLETE") == 0


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
