"""F30 `RETURN_PENDING` yaşam döngüsü — GERÇEK PostgreSQL.

Denetim bulgusu 4: geri dönüş yalnız `fail_stop` üzerinden test edilmişti.
**Dört ayrı yol** paketi kuryede bırakır ve hepsinde aynı kural geçerlidir:

    fail_stop · cancel_run · expire_stale_runs · postpone_delivery
        → paket HANDED_OVER → RETURN_PENDING (paket fiziksel olarak kuryede)

Sözleşme §3.5 kararı (bu commit'te kesinleştirildi):

* `RETURN_PENDING` paketi olan sipariş **`prep_queue`'da GÖRÜNMEZ** — depoda
  olmayan bir paket için "topla ve paketle" görevi üretmek yanlış iştir; personel
  ikinci bir kopya toplamaya kalkardı.
* Bunun yerine ayrı bir operasyon kuyruğunda görünür: `packing_service.return_queue`
  ("geri dönüş bekleniyor").
* `open_package` bu durumda ikinci paket AÇMAZ → 409 + mevcut paketin durumu.
* `RETURN_PENDING` paket `add_stops` ile yeni tura EKLENEMEZ.
* Yalnız depoda `return_in` ile okutulduktan (`RETURNED`) sonra `repack` veya
  `void` mümkündür.
"""
from __future__ import annotations

import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.store import Order
from services import delivery_service, order_service
from tests.integration.f30_factory import PaketFabrikasi


def _paketleme():
    try:
        from services import packing_service
    except ImportError as exc:  # noqa: PERF203
        pytest.fail(
            f"HENÜZ YAZILMADI: services/packing_service.py ({exc})", pytrace=False
        )
    return packing_service


def _zimmet():
    fn = getattr(delivery_service, "handover_scan", None)
    if fn is None:
        pytest.fail("HENÜZ YAZILMADI: delivery_service.handover_scan", pytrace=False)
    return fn


@pytest.fixture
async def fab(pg) -> PaketFabrikasi:
    f = PaketFabrikasi()
    yield f
    await f.temizle()


async def _sahaya_cikar(fab: PaketFabrikasi, servis, aid: int, kurye: int):
    """Zimmetlenmiş + turu başlamış durak. (order_id, paket, stop_id, run_id)"""
    zimmet = _zimmet()
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
        await zimmet(s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}")
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run)
    return oid, paket, stop_id, run


async def _prep_kuyrugunda(order_id: int) -> bool:
    async with AsyncSessionLocal() as s:
        return order_id in {o.order_id for o in await delivery_service.prep_queue(s)}


async def _paket_durumu(servis, paket_id: int) -> str:
    async with AsyncSessionLocal() as s:
        return (await servis.get_package(s, paket_id)).status


# ══════════════ Dört dönüş yolu: prep_queue'da GÖRÜNMEZ ═════════════════════


@pytest.mark.asyncio
async def test_1_fail_stop_sonrasi_PREP_KUYRUGUNDA_GORUNMEZ(fab):
    """Paket kuryede; depo onu yeniden toplamaya çalışmamalı."""
    servis = _paketleme()
    aid = await fab.admin()
    kurye = await fab.kurye()
    oid, paket, stop_id, _run = await _sahaya_cikar(fab, servis, aid, kurye)
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(
            s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK"
        )

    assert await _paket_durumu(servis, paket.id) == "RETURN_PENDING"
    assert await _prep_kuyrugunda(oid) is False


@pytest.mark.asyncio
async def test_2_cancel_run_sonrasi_PREP_KUYRUGUNDA_GORUNMEZ(fab):
    """Tur iptal edildi ama paketler araçta kaldı."""
    servis = _paketleme()
    aid = await fab.admin()
    kurye = await fab.kurye()
    oid, paket, _stop, run = await _sahaya_cikar(fab, servis, aid, kurye)
    async with AsyncSessionLocal() as s:
        await delivery_service.cancel_run(s, run)

    assert await _paket_durumu(servis, paket.id) == "RETURN_PENDING"
    assert await _prep_kuyrugunda(oid) is False


@pytest.mark.asyncio
async def test_3_expire_stale_runs_sonrasi_PREP_KUYRUGUNDA_GORUNMEZ(fab):
    """Watchdog turu kapattı (kurye telefonu öldü) — paket hâlâ araçta.

    `started_at` fixture kurulumu olarak geriye çekilir; ölçülen davranış
    watchdog'un kendisidir (`delivery_service.py:514-599`).
    """
    servis = _paketleme()
    from core.config import settings

    aid = await fab.admin()
    kurye = await fab.kurye()
    oid, paket, _stop, run = await _sahaya_cikar(fab, servis, aid, kurye)

    saat = max(settings.DELIVERY_STALE_RUN_HOURS, 1)
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE delivery_runs SET started_at = :t WHERE id = :i"),
            {
                "t": datetime.datetime.now(datetime.timezone.utc)
                - datetime.timedelta(hours=saat + 2),
                "i": run,
            },
        )
        await s.commit()
    async with AsyncSessionLocal() as s:
        kapanan = await delivery_service.expire_stale_runs(s)
    assert kapanan >= 1, "watchdog turu kapatmadı (DELIVERY_STALE_RUN_HOURS kapalı mı?)"

    assert await _paket_durumu(servis, paket.id) == "RETURN_PENDING"
    assert await _prep_kuyrugunda(oid) is False


@pytest.mark.asyncio
async def test_4_postpone_delivery_sonrasi_PREP_KUYRUGUNDA_GORUNMEZ(fab):
    """Müşteri erteledi; paket kuryede kaldı. `RESCHEDULED` durak `FAILED`'dan
    ayrıdır (kurye KPI'ına yazılmaz) ama paketin fiziksel yeri aynıdır."""
    servis = _paketleme()
    aid = await fab.admin()
    kurye = await fab.kurye()
    oid, paket, _stop, _run = await _sahaya_cikar(fab, servis, aid, kurye)

    async with AsyncSessionLocal() as s:
        siparis = await s.get(Order, oid)
        await order_service.postpone_delivery(s, siparis)
        await s.commit()

    assert await _paket_durumu(servis, paket.id) == "RETURN_PENDING"
    assert await _prep_kuyrugunda(oid) is False


# ══════════════ Ayrı operasyon kuyruğu ══════════════════════════════════════


@pytest.mark.asyncio
async def test_geri_donus_bekleyenler_AYRI_KUYRUKTA_gorunur(fab):
    """Görünmezlik yetmez: paket bir yerde görünmezse kimse aramaz ve süresiz
    kaybolur (TB-7). "Geri dönüş bekleniyor" kuyruğu bu yüzden zorunludur."""
    servis = _paketleme()
    aid = await fab.admin()
    kurye = await fab.kurye()
    oid, paket, stop_id, _run = await _sahaya_cikar(fab, servis, aid, kurye)
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(
            s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK"
        )

    async with AsyncSessionLocal() as s:
        kuyruk = await servis.return_queue(s)
    kayit = {k.package_id: k for k in kuyruk}
    assert paket.id in kayit, "RETURN_PENDING paket geri dönüş kuyruğunda yok"
    assert kayit[paket.id].order_id == oid
    assert kayit[paket.id].courier_id == kurye, "hangi kuryede olduğu görünmüyor"


# ══════════════ İkinci paket açılamaz ═══════════════════════════════════════


@pytest.mark.asyncio
async def test_5_RETURN_PENDING_iken_YENI_PAKET_ACILAMAZ(fab):
    """İkinci paket açmak, aynı ürünleri ikinci kez rafından almak demektir.

    409 dönerken **mevcut paketin durumu** da bildirilmelidir; operatör "neden
    açamıyorum" sorusunun cevabını ekranda görmeli.
    """
    servis = _paketleme()
    aid = await fab.admin()
    kurye = await fab.kurye()
    oid, paket, stop_id, _run = await _sahaya_cikar(fab, servis, aid, kurye)
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(
            s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK"
        )

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await servis.open_package(s, oid, admin_id=aid)
    assert hata.value.status_code == 409
    assert "RETURN_PENDING" in str(hata.value.detail)

    async with AsyncSessionLocal() as s:
        adet = (
            await s.execute(
                text("SELECT count(*) FROM order_packages WHERE order_id = :o"),
                {"o": oid},
            )
        ).scalar_one()
    assert adet == 1, "ikinci paket satırı oluştu"


# ══════════════ Tura eklenemez ══════════════════════════════════════════════


@pytest.mark.asyncio
async def test_6_RETURN_PENDING_paket_TURA_EKLENEMEZ(fab):
    """Depoda olmayan paket yeni bir tura yüklenemez; `eligible_orders` da onu
    göstermemelidir."""
    servis = _paketleme()
    aid = await fab.admin()
    kurye = await fab.kurye()
    oid, paket, stop_id, _run = await _sahaya_cikar(fab, servis, aid, kurye)
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(
            s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK"
        )

    async with AsyncSessionLocal() as s:
        uygun = {o.order_id for o in await delivery_service.eligible_orders(s)}
    assert oid not in uygun

    yeni_tur = await fab.tur(courier_id=kurye)
    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await delivery_service.add_stops(s, yeni_tur, [oid])
    assert hata.value.status_code == 409


# ══════════════ return_in sonrası kontrollü yeniden paketleme ═══════════════


@pytest.mark.asyncio
async def test_7_return_in_SONRASI_kontrollu_yeniden_paketleme(fab):
    """Sıra zorunludur: `RETURN_PENDING` → (depoda okut) `RETURNED` → `repack`.

    `return_in` yapılmadan `repack` denenirse 409; yapıldıktan sonra paket
    yeniden `PACKED` olur, `prepared_at` tazelenir ve sipariş tekrar `eligible`
    hâle gelir.
    """
    servis = _paketleme()
    aid = await fab.admin()
    kurye = await fab.kurye()
    oid, paket, stop_id, _run = await _sahaya_cikar(fab, servis, aid, kurye)
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(
            s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK"
        )

    # Sıra atlanamaz.
    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await servis.repack(s, paket.id, admin_id=aid)
    assert hata.value.status_code == 409

    async with AsyncSessionLocal() as s:
        donen = await servis.return_in(s, paket.id, admin_id=aid, note="Araçtan indi")
    assert donen.status == "RETURNED"
    assert donen.returned_at is not None

    async with AsyncSessionLocal() as s:
        yeniden = await servis.repack(s, paket.id, admin_id=aid)
    assert yeniden.status == "PACKED"
    assert await fab.prepared_at(oid) is not None

    async with AsyncSessionLocal() as s:
        uygun = {o.order_id for o in await delivery_service.eligible_orders(s)}
    assert oid in uygun


@pytest.mark.asyncio
async def test_RETURNED_paket_VOID_de_edilebilir(fab):
    """Kutu zarar gördüyse yeniden dağıtım yerine bozma yolu açık kalmalı."""
    servis = _paketleme()
    aid = await fab.admin()
    kurye = await fab.kurye()
    oid, paket, stop_id, _run = await _sahaya_cikar(fab, servis, aid, kurye)
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(
            s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK"
        )
    async with AsyncSessionLocal() as s:
        await servis.return_in(s, paket.id, admin_id=aid)
    async with AsyncSessionLocal() as s:
        sonuc = await servis.void(s, paket.id, admin_id=aid, reason="Kutu ezilmiş")
    assert sonuc.status == "VOID"

    # Bozulduktan sonra sipariş yeniden paketlenebilmeli.
    async with AsyncSessionLocal() as s:
        yeni = await servis.open_package(s, oid, admin_id=aid)
    assert yeni.id != paket.id and yeni.status == "OPEN"


@pytest.mark.asyncio
async def test_return_in_STOK_HAREKETI_YAZMAZ(fab):
    """Geri dönüş fiziksel bir konum olayıdır; `SALE` zaten ödemede yazıldı ve
    sipariş hâlâ açık (`PAID`). Defter satırı üretmek stoğu iki kez sayardı."""
    servis = _paketleme()
    aid = await fab.admin()
    kurye = await fab.kurye()
    oid, paket, stop_id, _run = await _sahaya_cikar(fab, servis, aid, kurye)
    pid = paket.items[0].product_id
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(
            s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK"
        )

    stok_once = await fab.stok(pid)
    hareket_once = await fab.hareket_sayisi(pid)
    async with AsyncSessionLocal() as s:
        await servis.return_in(s, paket.id, admin_id=aid)
    assert await fab.stok(pid) == stok_once
    assert await fab.hareket_sayisi(pid) == hareket_once
