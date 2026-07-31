"""F30 kurye zimmeti ve fiziksel durum — GERÇEK PostgreSQL.

Ölçülen: paketin işletme kontrolünden ÇIKIŞ anı, yanlış paketin reddi, çift
zimmetin etkisizliği, teslim edilemeyen paketin geri dönüşü ve QR'ın tur
değişse bile geçerli kalması (G3).

Sözleşme §3.4: `SHIPPED` artık `start_run` butonunda değil, kuryenin paketi
okutmasında yazılır — F29'un `ORDER_SHIPPED` tanımı (`reserved −1,
on_premise −1`) ancak o zaman fiziksel gerçeğe karşılık gelir.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from core.database import AsyncSessionLocal
from services import delivery_service
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
        pytest.fail(
            "HENÜZ YAZILMADI: delivery_service.handover_scan", pytrace=False
        )
    return fn


@pytest.fixture
async def fab(pg) -> PaketFabrikasi:
    f = PaketFabrikasi()
    yield f
    await f.temizle()


async def _paketle(fab: PaketFabrikasi, servis, aid: int, *, adet: int = 1):
    """Ödenmiş sipariş → tam doğrulanmış PACKED paket. (order_id, paket)"""
    pid, _sku, ean = await fab.barkodlu_urun(stock=10 + adet)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, adet)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    for _ in range(adet):
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)
    async with AsyncSessionLocal() as s:
        paket = await servis.complete(s, paket.id, admin_id=aid)
    return oid, paket


async def _tura_ekle(oid: int, run_id: int) -> int:
    async with AsyncSessionLocal() as s:
        tur = await delivery_service.add_stops(s, run_id, [oid])
    return [d for d in tur.stops if d.order_id == oid][0].id


async def _paket_durumu(servis, paket_id: int) -> str:
    async with AsyncSessionLocal() as s:
        return (await servis.get_package(s, paket_id)).status


# ══════════════════ Zimmet öncesi ═══════════════════════════════════════════


@pytest.mark.asyncio
async def test_zimmetten_ONCE_paket_ON_PREMISE(fab):
    """Kullanıcı maddesi: teslim alımından önce paket ON_PREMISE'dır.
    Hazırlanmış fakat kurye almamış paket hâlâ işletmenin kontrolündedir."""
    servis = _paketleme()
    from services import inventory_service

    aid = await fab.admin()
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _paketle(fab, servis, aid, adet=2)
    await _tura_ekle(oid, run)

    durum, odeme = await fab.siparis_durumu(oid)
    assert (durum, odeme) == ("PAID", "PAID"), "tura ekleme siparişi SHIPPED yaptı"
    assert await _paket_durumu(servis, paket.id) == "PACKED"

    async with AsyncSessionLocal() as s:
        pid = paket.items[0].product_id
        dokum = (await inventory_service.expected_on_premise(s, [pid]))[pid]
    assert dokum.reserved == 2


@pytest.mark.asyncio
async def test_add_stops_ARTIK_SHIPPED_YAPMAZ(fab):
    """Nöbetçi (sözleşme §3.4): aktif tura durak eklemek de artık siparişi
    dağıtımda saymaz — çıkışı zimmet yazar."""
    servis = _paketleme()
    aid = await fab.admin()
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye, status="ACTIVE")
    oid, _paket = await _paketle(fab, servis, aid)
    await _tura_ekle(oid, run)
    assert (await fab.siparis_durumu(oid))[0] == "PAID"


# ══════════════════ Zimmet ══════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_zimmet_DOGRU_AKTOR_VE_ZAMANLA_kaydedilir(fab):
    """Kullanıcı maddesi: kurye teslim alımı doğru actor ve zamanla kaydedilir."""
    servis = _paketleme()
    zimmet = _zimmet()
    aid = await fab.admin()
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _paketle(fab, servis, aid)
    await _tura_ekle(oid, run)

    async with AsyncSessionLocal() as s:
        await zimmet(s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}")

    async with AsyncSessionLocal() as s:
        taze = await servis.get_package(s, paket.id)
    assert taze.status == "HANDED_OVER"
    assert taze.handed_over_at is not None
    assert taze.handed_to_courier_id == kurye
    assert str(kurye) in (taze.handed_over_by_actor or "")


@pytest.mark.asyncio
async def test_zimmetten_SONRA_ON_PREMISE_disina_cikar(fab):
    """Kullanıcı maddesi 8: paket işletmeden çıktığında fiziksel durum değişir.

    Sipariş `SHIPPED` olur → F29 `reserved_on_premise` onu artık saymaz
    (`inventory_service.py:134`), yani `on_premise` gerçekten düşer.
    """
    servis = _paketleme()
    zimmet = _zimmet()
    from services import inventory_service

    aid = await fab.admin()
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _paketle(fab, servis, aid, adet=2)
    await _tura_ekle(oid, run)
    pid = paket.items[0].product_id

    async with AsyncSessionLocal() as s:
        once = (await inventory_service.expected_on_premise(s, [pid]))[pid]
    async with AsyncSessionLocal() as s:
        await zimmet(s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}")
    async with AsyncSessionLocal() as s:
        sonra = (await inventory_service.expected_on_premise(s, [pid]))[pid]

    assert (await fab.siparis_durumu(oid))[0] == "SHIPPED"
    assert sonra.reserved == once.reserved - 2
    assert sonra.total == once.total - 2


@pytest.mark.asyncio
async def test_zimmet_TAKIP_NUMARASI_yazar(fab):
    """`start_run`'dan taşınan sorumluluk: takip numarası zimmette doğar."""
    servis = _paketleme()
    zimmet = _zimmet()
    aid = await fab.admin()
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _paketle(fab, servis, aid)
    await _tura_ekle(oid, run)
    async with AsyncSessionLocal() as s:
        await zimmet(s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}")

    async with AsyncSessionLocal() as s:
        from sqlalchemy import text

        takip = (
            await s.execute(
                text("SELECT tracking_no FROM orders WHERE id = :i"), {"i": oid}
            )
        ).scalar_one()
    assert takip and takip.startswith("ELDEN-")


@pytest.mark.asyncio
async def test_BASKA_KURYENIN_paketi_KABUL_EDILMEZ(fab):
    """Kullanıcı maddesi: başka paketin QR'si kabul edilmez.

    IDOR deseni (`courier_account_service.ensure_run_access`): yabancı paket
    403 değil **404** döner — varlık sızmasın.
    """
    servis = _paketleme()
    zimmet = _zimmet()
    aid = await fab.admin()
    kurye_a = await fab.kurye()
    kurye_b = await fab.kurye()
    run_a = await fab.tur(courier_id=kurye_a)
    await fab.tur(courier_id=kurye_b)
    oid, paket = await _paketle(fab, servis, aid)
    await _tura_ekle(oid, run_a)

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await zimmet(
                s, paket.qr_payload, courier_id=kurye_b, actor=f"courier:{kurye_b}"
            )
    assert hata.value.status_code == 404
    assert await _paket_durumu(servis, paket.id) == "PACKED"


@pytest.mark.asyncio
async def test_TANIMSIZ_QR_reddedilir(fab):
    servis = _paketleme()
    zimmet = _zimmet()
    kurye = await fab.kurye()
    await fab.tur(courier_id=kurye)
    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await zimmet(s, "PKG1:999999:yok", courier_id=kurye, actor="courier:x")
    assert hata.value.status_code == 404


@pytest.mark.asyncio
async def test_ayni_paket_IKI_KEZ_zimmetlenemez(fab):
    """Aynı tarama tekrarı ikinci işlem üretmez: tek `SHIPPED` geçişi, tek
    geçmiş satırı, damga değişmez."""
    servis = _paketleme()
    zimmet = _zimmet()
    aid = await fab.admin()
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _paketle(fab, servis, aid)
    await _tura_ekle(oid, run)

    for _ in range(3):
        async with AsyncSessionLocal() as s:
            await zimmet(s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}")

    async with AsyncSessionLocal() as s:
        from sqlalchemy import text

        gecis = (
            await s.execute(
                text(
                    "SELECT count(*) FROM order_status_history "
                    "WHERE order_id = :o AND new_status = 'SHIPPED'"
                ),
                {"o": oid},
            )
        ).scalar_one()
    assert gecis == 1, "çift zimmet ikinci SHIPPED geçişi üretti"


@pytest.mark.asyncio
async def test_PACKED_OLMAYAN_paket_zimmetlenemez(fab):
    """Eksik (OPEN) paket araca yüklenemez."""
    servis = _paketleme()
    zimmet = _zimmet()
    aid = await fab.admin()
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    pid, _sku, _ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 2)], prepared=True)
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    await _tura_ekle(oid, run)

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await zimmet(s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}")
    assert hata.value.status_code == 409


# ══════════════════ Tur başlatma ön koşulu ══════════════════════════════════


@pytest.mark.asyncio
async def test_ZIMMETSIZ_durak_varken_tur_BASLATILAMAZ(fab):
    """Sözleşme §3.4: kurye eksik paketle yola çıkamaz."""
    servis = _paketleme()
    zimmet = _zimmet()
    aid = await fab.admin()
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    o1, p1 = await _paketle(fab, servis, aid)
    o2, _p2 = await _paketle(fab, servis, aid)
    await _tura_ekle(o1, run)
    await _tura_ekle(o2, run)
    async with AsyncSessionLocal() as s:
        await zimmet(s, p1.qr_payload, courier_id=kurye, actor=f"courier:{kurye}")

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await delivery_service.start_run(s, run)
    assert hata.value.status_code == 409
    assert str(o2) in str(hata.value.detail), "eksik paket listesi yanıtta yok"


@pytest.mark.asyncio
async def test_TUM_paketler_zimmetliyse_tur_BASLAR(fab):
    servis = _paketleme()
    zimmet = _zimmet()
    aid = await fab.admin()
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    o1, p1 = await _paketle(fab, servis, aid)
    await _tura_ekle(o1, run)
    async with AsyncSessionLocal() as s:
        await zimmet(s, p1.qr_payload, courier_id=kurye, actor=f"courier:{kurye}")
    async with AsyncSessionLocal() as s:
        tur = await delivery_service.start_run(s, run)
    assert tur.status == "ACTIVE"
    assert (await fab.siparis_durumu(o1))[0] == "SHIPPED"


# ══════════════════ Geri dönüş ══════════════════════════════════════════════


@pytest.mark.asyncio
async def test_teslim_edilemeyen_paket_RETURN_PENDING_olur(fab):
    """Kullanıcı maddesi 9 / G5: paket kuryede kalır ve geri bekleniyor
    işaretlenir — "depoya döndü" varsayımı yapılmaz."""
    servis = _paketleme()
    zimmet = _zimmet()
    aid = await fab.admin()
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _paketle(fab, servis, aid)
    stop_id = await _tura_ekle(oid, run)
    async with AsyncSessionLocal() as s:
        await zimmet(s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}")
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run)
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(
            s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK"
        )

    assert await _paket_durumu(servis, paket.id) == "RETURN_PENDING"
    assert (await fab.siparis_durumu(oid))[0] == "PAID"
    assert await fab.prepared_at(oid) is None, "geri dönmeden hazır sayılıyor"


@pytest.mark.asyncio
async def test_RETURN_PENDING_paket_TURA_EKLENEMEZ(fab):
    """Fiziksel olarak kuryede olan paket yeniden dağıtıma sokulamaz;
    `eligible_orders` onu görmemeli."""
    servis = _paketleme()
    zimmet = _zimmet()
    aid = await fab.admin()
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _paketle(fab, servis, aid)
    stop_id = await _tura_ekle(oid, run)
    async with AsyncSessionLocal() as s:
        await zimmet(s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}")
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run)
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK")

    async with AsyncSessionLocal() as s:
        uygun = {o.order_id for o in await delivery_service.eligible_orders(s)}
    assert oid not in uygun


@pytest.mark.asyncio
async def test_BILINEN_SAPMA_return_pending_F29_tarafinda_isletmede_gorunur(fab):
    """Sözleşme §7 S1 — bilinçli borcun testi (CLAUDE.md §I: gizlenmez).

    `fail_stop` siparişi `PAID`'e döndürdüğü için F29 `reserved_on_premise`
    paketi işletmede sayar; oysa paket kuryededir. Pencere: teslim denemesi →
    akşam `return_in`. F29 formülü F30'da DEĞİŞTİRİLMEDİ (kapalı paket).

    Bu test sapmayı **sabitler**: davranış bilinçli değişirse (F29 açılırsa)
    kırmızıya döner ve kimse sessizce düzelttiğini sanmaz.
    """
    servis = _paketleme()
    zimmet = _zimmet()
    from services import inventory_service

    aid = await fab.admin()
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _paketle(fab, servis, aid, adet=2)
    pid = paket.items[0].product_id
    stop_id = await _tura_ekle(oid, run)
    async with AsyncSessionLocal() as s:
        await zimmet(s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}")
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run)
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK")

    async with AsyncSessionLocal() as s:
        dokum = (await inventory_service.expected_on_premise(s, [pid]))[pid]
        paket_taze = await servis.get_package(s, paket.id)

    from services.packing_rules import is_on_premise

    assert dokum.reserved == 2, "F29 sapması kapanmış — S1 borcu artık geçersiz"
    assert is_on_premise(paket_taze.status) is False, "paket gerçekte kuryede"


@pytest.mark.asyncio
async def test_return_in_ile_paket_ISLETMEYE_DONER(fab):
    """Kullanıcı maddesi 9: geri gelen paket tekrar işletme kontrolüne alınır
    — okutularak, varsayımla değil."""
    servis = _paketleme()
    zimmet = _zimmet()
    aid = await fab.admin()
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _paketle(fab, servis, aid)
    stop_id = await _tura_ekle(oid, run)
    async with AsyncSessionLocal() as s:
        await zimmet(s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}")
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run)
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK")

    async with AsyncSessionLocal() as s:
        sonuc = await servis.return_in(
            s, paket.id, admin_id=aid, note="Akşam araçtan indi"
        )
    assert sonuc.status == "RETURNED"
    assert sonuc.returned_at is not None

    from services.packing_rules import is_on_premise

    assert is_on_premise("RETURNED") is True


@pytest.mark.asyncio
async def test_return_in_YAPILMADAN_yeniden_zimmetlenemez(fab):
    """Belirsiz fiziksel olayda tahmin yok: geri geldiği doğrulanmayan paket
    yeni tura verilemez."""
    servis = _paketleme()
    zimmet = _zimmet()
    aid = await fab.admin()
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _paketle(fab, servis, aid)
    stop_id = await _tura_ekle(oid, run)
    async with AsyncSessionLocal() as s:
        await zimmet(s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}")
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run)
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK")

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await zimmet(s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}")
    assert hata.value.status_code == 409


@pytest.mark.asyncio
async def test_RETURNED_paket_repack_ile_yeniden_dagitima_girer(fab):
    """Paket açılmadıysa içerik yeniden doğrulanmaz; operatör onayı yeterlidir
    ve `prepared_at` yeniden damgalanır → sipariş tekrar `eligible`."""
    servis = _paketleme()
    zimmet = _zimmet()
    aid = await fab.admin()
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _paketle(fab, servis, aid)
    stop_id = await _tura_ekle(oid, run)
    async with AsyncSessionLocal() as s:
        await zimmet(s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}")
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run)
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK")
    async with AsyncSessionLocal() as s:
        await servis.return_in(s, paket.id, admin_id=aid)
    async with AsyncSessionLocal() as s:
        sonuc = await servis.repack(s, paket.id, admin_id=aid)

    assert sonuc.status == "PACKED"
    assert await fab.prepared_at(oid) is not None
    async with AsyncSessionLocal() as s:
        uygun = {o.order_id for o in await delivery_service.eligible_orders(s)}
    assert oid in uygun


@pytest.mark.asyncio
async def test_paket_QR_si_TUR_DEGISSE_BILE_GECERLI_KALIR(fab):
    """G3'ün düzeltmesi — F30'un en somut operasyon kazancı.

    Bugün QR `DeliveryStop`'a ait: durak silinince/tur iptal olunca token
    kaybolur ve **fiziksel paketin üstündeki basılı etiket 2. denemede
    geçersizleşir** (kurye 404 alır). Paket QR'ı kalıcıdır: aynı etiket ikinci
    turda da okunur.
    """
    servis = _paketleme()
    zimmet = _zimmet()
    aid = await fab.admin()
    kurye = await fab.kurye()
    run1 = await fab.tur(courier_id=kurye)
    oid, paket = await _paketle(fab, servis, aid)
    etiket = paket.qr_payload            # kâğıda basıldı, paketin üstünde
    stop_id = await _tura_ekle(oid, run1)
    async with AsyncSessionLocal() as s:
        await zimmet(s, etiket, courier_id=kurye, actor=f"courier:{kurye}")
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run1)
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK")
    async with AsyncSessionLocal() as s:
        await servis.return_in(s, paket.id, admin_id=aid)
    async with AsyncSessionLocal() as s:
        await servis.repack(s, paket.id, admin_id=aid)

    run2 = await fab.tur(courier_id=kurye)
    await _tura_ekle(oid, run2)
    async with AsyncSessionLocal() as s:
        await zimmet(s, etiket, courier_id=kurye, actor=f"courier:{kurye}")

    assert await _paket_durumu(servis, paket.id) == "HANDED_OVER"


@pytest.mark.asyncio
async def test_TUR_IPTALINDE_zimmetli_paket_RETURN_PENDING(fab):
    servis = _paketleme()
    zimmet = _zimmet()
    aid = await fab.admin()
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _paketle(fab, servis, aid)
    await _tura_ekle(oid, run)
    async with AsyncSessionLocal() as s:
        await zimmet(s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}")
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run)
    async with AsyncSessionLocal() as s:
        await delivery_service.cancel_run(s, run)

    assert await _paket_durumu(servis, paket.id) == "RETURN_PENDING"


@pytest.mark.asyncio
async def test_TESLIM_EDILINCE_paket_DELIVERED(fab):
    servis = _paketleme()
    zimmet = _zimmet()
    aid = await fab.admin()
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _paketle(fab, servis, aid)
    stop_id = await _tura_ekle(oid, run)
    async with AsyncSessionLocal() as s:
        await zimmet(s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}")
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run)
    async with AsyncSessionLocal() as s:
        await delivery_service.override_deliver(
            s, stop_id, note="Yönetici teslimi (test)"
        )

    assert await _paket_durumu(servis, paket.id) == "DELIVERED"
    assert (await fab.siparis_durumu(oid))[0] == "DELIVERED"


@pytest.mark.asyncio
async def test_SHIPPED_siparis_IPTAL_edilirse_paket_GERI_BEKLENIR(fab):
    """Sözleşme §3.5: OFF_PREMISE paket doğrudan VOID edilemez — kurye
    getirecek. Aksi hâlde envanter, araçtaki paketi yok saymış olurdu."""
    servis = _paketleme()
    zimmet = _zimmet()
    from models.store import Order
    from services import order_fsm

    aid = await fab.admin()
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _paketle(fab, servis, aid)
    await _tura_ekle(oid, run)
    async with AsyncSessionLocal() as s:
        await zimmet(s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}")
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run)

    async with AsyncSessionLocal() as s:
        siparis = await s.get(Order, oid)
        await order_fsm.transition_order(
            s, siparis, "REFUNDED", changed_by="admin", reason="müşteri vazgeçti"
        )
        await s.commit()

    assert await _paket_durumu(servis, paket.id) == "RETURN_PENDING"
