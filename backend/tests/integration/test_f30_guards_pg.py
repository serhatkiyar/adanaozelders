"""F30 guard'larının İZOLE davranış kanıtları — GERÇEK PostgreSQL.

Commit 3 bağımsız denetiminin taşıdığı borçlar (P2-A · P2-B · P2-C · P2-D ·
P2-F). Hepsinin ortak kusuru aynıydı: guard'ın kendisi doğru yazılmıştı ama
**onu kanıtladığı sanılan test, 409'u başka bir kontrolden alıyordu**. Böyle bir
test guard silinse de yeşil kalır — yani hiçbir şeyin nöbetçisi değildir.

Bu dosyanın kuralı: her düğüm, ölçtüğü guard DIŞINDAKİ bütün ön koşulları
**sağlayan** bir kurulum hazırlar ve hata gövdesinden guard'ı ayırt eder
(`detail` içinde beklenen durum adı / paket kodu aranır). Her düğümün mutasyon
karşılığı `scripts`'siz bir sürücüyle koşulmuştur; ayrıntı kapanış raporunda.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.store import Order
from services import delivery_service, order_service
from tests.integration.f30_factory import PaketFabrikasi


def _servis():
    from services import packing_service

    return packing_service


@pytest.fixture
async def fab(pg) -> PaketFabrikasi:
    f = PaketFabrikasi()
    try:
        yield f
    finally:
        await f.temizle()


async def _acik_paket(fab: PaketFabrikasi, servis, aid: int, *, adet: int = 1):
    """(order_id, paket, ean) — OPEN paket."""
    pid, _sku, ean = await fab.barkodlu_urun(stock=10 + adet)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, adet)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    return oid, paket, ean


async def _packed_paket(fab: PaketFabrikasi, servis, aid: int, *, adet: int = 1):
    oid, paket, ean = await _acik_paket(fab, servis, aid, adet=adet)
    for _ in range(adet):
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)
    async with AsyncSessionLocal() as s:
        paket = await servis.complete(s, paket.id, admin_id=aid)
    return oid, paket, ean


async def _sahada_paket(fab: PaketFabrikasi, servis, aid: int, kurye: int):
    """(order_id, paket, stop_id, run_id) — zimmetlenmiş, turu başlamış."""
    run = await fab.tur(courier_id=kurye)
    oid, paket, _ean = await _packed_paket(fab, servis, aid)
    async with AsyncSessionLocal() as s:
        tur = await delivery_service.add_stops(s, run, [oid])
    stop_id = [d for d in tur.stops if d.order_id == oid][0].id
    async with AsyncSessionLocal() as s:
        await delivery_service.handover_scan(
            s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}"
        )
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run)
    return oid, paket, stop_id, run


# ══════════════════ P2-A · return_in kaynak durum guard'ı ═══════════════════


@pytest.mark.asyncio
@pytest.mark.parametrize("durum", ["OPEN", "PACKED", "HANDED_OVER", "VOID"])
async def test_P2A_return_in_YANLIS_DURUMDAN_409(fab, durum):
    """`return_in` yalnız `RETURN_PENDING`'ten çalışır — ve 409'u BU guard verir.

    Denetim bulgusu: eski kapsama `return_in`'i yalnız doğru durumdan
    çağırıyordu; yanlış kaynak durum hiç denenmemişti. Dört kaynak durum ayrı
    ayrı denenir — tek örnekle test edilseydi `from_statuses`'ün yanlışlıkla
    genişletilmesi (ör. `HANDED_OVER` eklenip paketin geri geldiğinin
    OKUTULMADAN varsayılması) sessizce geçerdi. `HANDED_OVER` özellikle
    kritiktir: G5'in tamamı "paket geri döndü" varsayımını yasaklamak üzerine
    kuruludur.

    Ayırt edicilik: paket VARDIR, sipariş AÇIKTIR, aktör GEÇERLİDİR — yani 409
    alınabilecek başka hiçbir ön koşul ihlal edilmemiştir; ve gövde hem
    beklenen kaynak durumu (`RETURN_PENDING`) hem mevcut durumu adıyla söyler.
    """
    servis = _servis()
    aid = await fab.admin()
    kurye = await fab.kurye()

    if durum == "OPEN":
        oid, paket, _ean = await _acik_paket(fab, servis, aid)
    elif durum == "PACKED":
        oid, paket, _ean = await _packed_paket(fab, servis, aid)
    elif durum == "HANDED_OVER":
        oid, paket, _stop, _run = await _sahada_paket(fab, servis, aid, kurye)
    else:
        oid, paket, _ean = await _acik_paket(fab, servis, aid)
        async with AsyncSessionLocal() as s:
            await servis.void(s, paket.id, admin_id=aid, reason="Kutu yırtıldı")

    # Ön koşullar sağlanıyor mu? (409'un başka yerden gelmediğinin kanıtı)
    async with AsyncSessionLocal() as s:
        taze = await servis.get_package(s, paket.id)
    assert taze.status == durum
    assert (await fab.siparis_durumu(oid))[0] in ("PAID", "SHIPPED")

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await servis.return_in(s, paket.id, admin_id=aid, note="depoya indi")
    assert hata.value.status_code == 409
    detay = str(hata.value.detail)
    assert "RETURN_PENDING" in detay, f"409 başka bir guard'dan gelmiş: {detay}"
    assert durum in detay

    # Yan etki YOK: durum ve `returned_at` olduğu gibi kalmalı.
    async with AsyncSessionLocal() as s:
        sonra = await servis.get_package(s, paket.id)
    assert sonra.status == durum
    assert sonra.returned_at is None


@pytest.mark.asyncio
async def test_P2A_return_in_TEKRARI_IDEMPOTENT(fab):
    """`RETURNED` "yanlış kaynak durum" DEĞİLDİR — hedefin kendisidir.

    Bu ayrım bilinçli: depoda paketi iki kez okutan operatör 409 görmemeli,
    ama ikinci bir `RETURN_IN` izi de yazılmamalı (append-only defterde
    olmayan bir fiziksel olay birikmesin).
    """
    servis = _servis()
    aid = await fab.admin()
    kurye = await fab.kurye()
    _oid, paket, stop_id, _run = await _sahada_paket(fab, servis, aid, kurye)
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(
            s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK"
        )
    async with AsyncSessionLocal() as s:
        birinci = await servis.return_in(s, paket.id, admin_id=aid, note="indi")
    async with AsyncSessionLocal() as s:
        ikinci = await servis.return_in(s, paket.id, admin_id=aid, note="yine indi")
    assert ikinci.status == "RETURNED"
    assert ikinci.returned_at == birinci.returned_at
    assert ikinci.return_note == "indi", "ikinci çağrı notu ezmiş"

    async with AsyncSessionLocal() as s:
        adet = (
            await s.execute(
                text(
                    "SELECT count(*) FROM package_scan_events "
                    "WHERE package_id = :p AND event_type = 'RETURN_IN'"
                ),
                {"p": paket.id},
            )
        ).scalar_one()
    assert adet == 1


# ══════════════════ P2-B · void gerekçe zorunluluğu ═════════════════════════


@pytest.mark.asyncio
@pytest.mark.parametrize("gerekce", ["", "   ", "\t\n ", None])
async def test_P2B_void_GEREKCESIZ_422_ve_HAM_DB_HATASI_SIZMAZ(fab, gerekce):
    """Boş/whitespace/eksik gerekçe **422**'dir — `IntegrityError` DEĞİL.

    İki katman da gerekçe ister: servis (`_require_reason`) ve DB
    (`ck_order_packages_void`, `btrim(void_reason) <> ''`). Kontrol servisten
    kaldırılırsa istek DB'ye kadar iner ve kullanıcı 500/409 görür — yani
    "gerekçe zorunlu" kuralı **teknik bir hataya** dönüşür. Bu test tam olarak
    o farkı ölçer: hata sınıfı `HTTPException`, kod 422, gövde gerekçe ister.
    """
    servis = _servis()
    aid = await fab.admin()
    _oid, paket, _ean = await _acik_paket(fab, servis, aid)

    from sqlalchemy.exc import IntegrityError

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            try:
                await servis.void(s, paket.id, admin_id=aid, reason=gerekce)
            except IntegrityError as exc:  # pragma: no cover — regresyonda kırar
                pytest.fail(f"ham DB hatası dışarı sızdı: {exc}")
    assert hata.value.status_code == 422
    assert "gerekçe" in str(hata.value.detail).lower()

    # Paket dokunulmamış olmalı — yarım bir VOID kalmadı.
    async with AsyncSessionLocal() as s:
        sonra = await servis.get_package(s, paket.id)
    assert sonra.status == "OPEN"
    assert sonra.void_at is None and sonra.void_reason is None


@pytest.mark.asyncio
async def test_P2B_void_GERCEK_GEREKCEYLE_calisir(fab):
    """Ters prova: guard yalnız BOŞ gerekçeyi reddetmeli, hepsini değil.
    Aksi hâlde yukarıdaki test "void hiç çalışmıyor" hâlinde de yeşil kalırdı."""
    servis = _servis()
    aid = await fab.admin()
    _oid, paket, _ean = await _acik_paket(fab, servis, aid)
    async with AsyncSessionLocal() as s:
        sonuc = await servis.void(s, paket.id, admin_id=aid, reason="  Kutu yırtıldı  ")
    assert sonuc.status == "VOID"
    assert sonuc.void_reason == "Kutu yırtıldı", "gerekçe kırpılmadan yazılmış"


# ══════════════════ P2-C · add_stops paket guard'ı ══════════════════════════


@pytest.mark.asyncio
async def test_P2C_add_stops_YALNIZ_PAKET_YUZUNDEN_409(fab):
    """Sipariş bütün teslimat koşullarını sağlıyor; tek engel paketin ARAÇTA olması.

    Denetim bulgusu: eski test `fail_stop` kullanıyordu, o da
    `roll_promise_after_failed_attempt` ile `prepared_at`'i sıfırlıyordu —
    dolayısıyla `add_stops` 409'u **"henüz hazırlanmadı"** kontrolünden
    veriyordu ve paket guard'ı silinse de test yeşil kalırdı.

    Burada `postpone_delivery` kullanılır: `prepared_at`'i SIFIRLAMAZ, durağı
    `RESCHEDULED` yapar (açık durak kalmaz) ve siparişi `PAID`'e döndürür.
    Yani ödenmiş · fiziksel · bölge-içi · **hazırlanmış** · açık durağı olmayan
    bir sipariş kalır ve tek fark paketin `RETURN_PENDING` olmasıdır.
    """
    servis = _servis()
    aid = await fab.admin()
    kurye = await fab.kurye()
    oid, paket, _stop, _run = await _sahada_paket(fab, servis, aid, kurye)

    async with AsyncSessionLocal() as s:
        siparis = await s.get(Order, oid)
        await order_service.postpone_delivery(s, siparis)
        await s.commit()

    # ── Ön koşulların HEPSİ sağlanıyor mu? ──
    durum, odeme = await fab.siparis_durumu(oid)
    assert (durum, odeme) == ("PAID", "PAID")
    assert await fab.prepared_at(oid) is not None, "hazırlık damgası düşmüş — izole değil"
    async with AsyncSessionLocal() as s:
        acik_durak = await delivery_service._has_open_stop(s, oid)
        taze = await servis.get_package(s, paket.id)
    assert acik_durak is False, "açık durak kalmış — 409 oradan gelebilir"
    assert taze.status == "RETURN_PENDING"

    yeni_tur = await fab.tur(courier_id=kurye)
    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await delivery_service.add_stops(s, yeni_tur, [oid])
    assert hata.value.status_code == 409
    detay = str(hata.value.detail)
    assert "RETURN_PENDING" in detay and taze.code in detay, (
        f"409 paket guard'ından gelmiyor: {detay}"
    )

    # Durak GERÇEKTEN oluşmamalı (409 mesajı doğru ama kayıt sızmış olmasın).
    async with AsyncSessionLocal() as s:
        adet = (
            await s.execute(
                text("SELECT count(*) FROM delivery_stops WHERE run_id = :r"),
                {"r": yeni_tur},
            )
        ).scalar_one()
    assert adet == 0


@pytest.mark.asyncio
async def test_P2C_geri_donen_paket_TURA_YENIDEN_EKLENEBILIR(fab):
    """Ters prova: guard `RETURN_PENDING`'i engellemeli, her paketi değil.

    `return_in` + `repack` sonrası aynı sipariş aynı tura sorunsuz eklenebilir;
    aksi hâlde yukarıdaki test, `add_stops`'un tamamen bozulduğu hâlde de
    yeşil kalırdı.
    """
    servis = _servis()
    aid = await fab.admin()
    kurye = await fab.kurye()
    oid, paket, stop_id, _run = await _sahada_paket(fab, servis, aid, kurye)
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(
            s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK"
        )
    async with AsyncSessionLocal() as s:
        await servis.return_in(s, paket.id, admin_id=aid)
    async with AsyncSessionLocal() as s:
        await servis.repack(s, paket.id, admin_id=aid)

    yeni_tur = await fab.tur(courier_id=kurye)
    async with AsyncSessionLocal() as s:
        tur = await delivery_service.add_stops(s, yeni_tur, [oid])
    assert [d.order_id for d in tur.stops] == [oid]


# ══════ Commit 4 asgari güvenlik guard'ı · elle "Hazır" ↔ paketleme ═════════


@pytest.mark.asyncio
@pytest.mark.parametrize("durum", ["OPEN", "RETURN_PENDING", "RETURNED"])
async def test_C4_mark_prepared_ACIK_PAKETI_EZEMEZ(fab, durum):
    """Elle "Hazır" butonu paketleme istasyonunu EZEMEZ.

    Commit 4 paketleme istasyonunu HTTP'ye açtı; eski `mark_prepared` ucu ise
    commit 5'e kadar duruyor (sözleşme §3.5/§8). O pencerede iki kapı birden
    açıktır: yarım kalmış (`OPEN`), araçta bekleyen (`RETURN_PENDING`) ya da
    henüz yeniden onaylanmamış (`RETURNED`) bir paket varken elle "hazır"
    demek, **doğrulanmamış bir paketi `eligible_orders`'a sokmak** demektir.

    Bu, denetim raporundaki "geçiş dönemi zimmetsiz gönderim boşluğu"nun
    commit 4 tarafından canlı hâle getirilen ayağıdır ve asgari guard budur.
    Boşluğun tamamı (uçların kaldırılması) commit 5'e aittir.
    """
    servis = _servis()
    aid = await fab.admin()
    kurye = await fab.kurye()

    if durum == "OPEN":
        oid, paket, _ean = await _acik_paket(fab, servis, aid)
    else:
        oid, paket, stop_id, _run = await _sahada_paket(fab, servis, aid, kurye)
        async with AsyncSessionLocal() as s:
            await delivery_service.fail_stop(
                s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK"
            )
        if durum == "RETURNED":
            async with AsyncSessionLocal() as s:
                await servis.return_in(s, paket.id, admin_id=aid)

    # Ön koşullar: sipariş elle hazırlanmaya UYGUN (ödenmiş, fiziksel,
    # bölge-içi) — 409'un başka bir kontrolden gelmediğinin kanıtı.
    durum_o, odeme = await fab.siparis_durumu(oid)
    assert (durum_o, odeme) == ("PAID", "PAID")
    assert await fab.prepared_at(oid) is None

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await delivery_service.mark_prepared(s, oid, prepared=True)
    assert hata.value.status_code == 409
    detay = str(hata.value.detail)
    assert paket.code in detay and durum in detay, (
        f"409 paket guard'ından gelmiyor: {detay}"
    )
    assert await fab.prepared_at(oid) is None, "hazır damgası yine de yazılmış"


@pytest.mark.asyncio
async def test_C4_mark_prepared_PAKETSIZ_SIPARISTE_calisir(fab):
    """Ters prova: guard yalnız PAKETİ OLAN siparişi engellemeli.

    F30 öncesinden gelen (paketi hiç olmayan) sipariş eski akışta hazırlanmaya
    devam eder — koşulsuz dayatma commit 5'te, elle uçların kaldırılmasıyla
    AYNI ANDA gelir. Aksi hâlde bu guard mevcut operasyonu kilitlerdi.
    """
    pid, _sku, _ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    async with AsyncSessionLocal() as s:
        await delivery_service.mark_prepared(s, oid, prepared=True)
    assert await fab.prepared_at(oid) is not None


@pytest.mark.asyncio
async def test_C4_mark_prepared_TAMAMLANMIS_PAKETTE_calisir(fab):
    """`PACKED` paket zaten doğrulanmıştır; elle damga onu bozmaz (no-op)."""
    servis = _servis()
    aid = await fab.admin()
    oid, _paket, _ean = await _packed_paket(fab, servis, aid)
    once = await fab.prepared_at(oid)
    assert once is not None, "complete prepared_at damgalamadı"
    async with AsyncSessionLocal() as s:
        await delivery_service.mark_prepared(s, oid, prepared=True)
    assert await fab.prepared_at(oid) == once, "elle damga paketleme damgasını ezdi"


# ══════════════════ P2-D · undo_scan idempotency ════════════════════════════


@pytest.mark.asyncio
async def test_P2D_undo_scan_AYNI_ANAHTAR_BIR_KEZ_AZALTIR(fab):
    """Ağ tekrarı adedi İKİ kez düşüremez (P2-D kararı: anahtarlı idempotency).

    `undo_scan` durum-idempotan DEĞİLDİR — `scan` gibi bir tavana çarpmaz,
    her çağrı bir azaltır. El terminali isteği yeniden gönderirse tam paket
    eksik görünür ve `complete` reddedilir. Tek koruma anahtardır.
    """
    servis = _servis()
    aid = await fab.admin()
    oid, paket, ean = await _acik_paket(fab, servis, aid, adet=3)
    for _ in range(3):
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)

    kalem = paket.items[0].order_item_id
    for _ in range(3):
        async with AsyncSessionLocal() as s:
            sonuc = await servis.undo_scan(
                s, paket.id, order_item_id=kalem, admin_id=aid,
                reason="Kutuya yanlış kondu", idempotency_key="geri-al-1",
            )
        assert sonuc.result == "OK"

    async with AsyncSessionLocal() as s:
        taze = await servis.get_package(s, paket.id)
    assert taze.items[0].scanned_qty == 2, "aynı anahtar adedi birden fazla düşürdü"

    async with AsyncSessionLocal() as s:
        olaylar = (
            await s.execute(
                text(
                    "SELECT count(*) FROM package_scan_events "
                    "WHERE package_id = :p AND event_type = 'UNDO_SCAN'"
                ),
                {"p": paket.id},
            )
        ).scalar_one()
    assert olaylar == 1, "tekrar ikinci bir UNDO_SCAN izi yazdı"
    assert oid  # kullanılmayan değişken uyarısı yerine anlamlı bağ


@pytest.mark.asyncio
async def test_P2D_undo_scan_ANAHTARSIZ_IKI_KEZ_AZALTIR(fab):
    """Nöbetçi: koruma anahtar VERİLDİĞİNDE çalışır.

    İki ayrı yanlış okutmanın iki ayrı düzeltmesi meşrudur; aksi hâlde test
    idempotency'i "her tekrar yutulur" diye yanlış sabitlerdi.
    """
    servis = _servis()
    aid = await fab.admin()
    _oid, paket, ean = await _acik_paket(fab, servis, aid, adet=3)
    for _ in range(3):
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)
    kalem = paket.items[0].order_item_id
    for _ in range(2):
        async with AsyncSessionLocal() as s:
            await servis.undo_scan(
                s, paket.id, order_item_id=kalem, admin_id=aid, reason="düzeltme"
            )
    async with AsyncSessionLocal() as s:
        taze = await servis.get_package(s, paket.id)
    assert taze.items[0].scanned_qty == 1


@pytest.mark.asyncio
async def test_P2D_undo_scan_AYNI_ANAHTAR_FARKLI_YUK_409(fab):
    """Aynı anahtar başka bir kaleme uygulanamaz — sessizce yutulursa istemci
    ikinci düzeltmenin yapıldığını sanır ve paket eksik gider."""
    servis = _servis()
    aid = await fab.admin()
    p1, _s1, ean1 = await fab.barkodlu_urun(stock=10)
    p2, _s2, ean2 = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(p1, 1), (p2, 1)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    for kod in (ean1, ean2):
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=kod, admin_id=aid)

    k1, k2 = (r.order_item_id for r in paket.items)
    async with AsyncSessionLocal() as s:
        await servis.undo_scan(
            s, paket.id, order_item_id=k1, admin_id=aid,
            reason="ilk düzeltme", idempotency_key="ortak",
        )
    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await servis.undo_scan(
                s, paket.id, order_item_id=k2, admin_id=aid,
                reason="ikinci düzeltme", idempotency_key="ortak",
            )
    assert hata.value.status_code == 409
    assert "order_item_id" in str(hata.value.detail)

    async with AsyncSessionLocal() as s:
        taze = await servis.get_package(s, paket.id)
    adetler = {r.order_item_id: r.scanned_qty for r in taze.items}
    assert adetler == {k1: 0, k2: 1}, "çakışan anahtar ikinci satırı da düşürmüş"


@pytest.mark.asyncio
async def test_P2D_TARAMA_ANAHTARI_GERI_ALMAYA_UYGULANAMAZ(fab):
    """Anahtar uzayı ortaktır (`(package_id, key)`), bu yüzden `op` yükün parçası.

    Olmasaydı: taramanın anahtarı geri almaya verildiğinde kısmi unique index
    onu "aynı istek" sanar, `_idem_tekrari` ilk sonucu döndürür ve **adet hiç
    düşmez** — istemci düzeltmenin yapıldığını sanır.
    """
    servis = _servis()
    aid = await fab.admin()
    _oid, paket, ean = await _acik_paket(fab, servis, aid, adet=2)
    async with AsyncSessionLocal() as s:
        await servis.scan(s, paket.id, code=ean, admin_id=aid, idempotency_key="k")

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await servis.undo_scan(
                s, paket.id, order_item_id=paket.items[0].order_item_id,
                admin_id=aid, reason="yanlış", idempotency_key="k",
            )
    assert hata.value.status_code == 409
    assert "op" in str(hata.value.detail)

    async with AsyncSessionLocal() as s:
        taze = await servis.get_package(s, paket.id)
    assert taze.items[0].scanned_qty == 1, "geri alma sessizce yutuldu"


# ══════ Commit 4 denetimi · savepoint / tekrar dalı nöbetçisi ══════════════


@pytest.mark.asyncio
async def test_C5_TEKRAR_DALI_ADET_KALICI_KILMAZ(fab):
    """Anahtarlı tekrar hiçbir adet değişikliğini KALICI kılmaz.

    Commit 4 denetiminin "yanlış savepoint yorumu" bulgusunun nöbetçisi.
    Denetim sırasında ortaya çıkan asıl gerçek şuydu: `_tarama_uygula`'daki
    `IntegrityError` kurtarma dalı **hiç çalışmıyordu** (mutasyon provası:
    oraya `commit` eklemek hiçbir testi kırmadı) — çünkü `Order` satır kilidi
    eşzamanlı istekleri serileştiriyor ve ikincisi `_idem_tekrari` ön
    kontrolünde yakalanıyor, INSERT'e hiç varmıyor. Test edilemeyen kurtarma
    kodu koruma değil gürültü olduğundan kaldırıldı.

    Geriye kalan ve GERÇEKTEN koruyan katman `_idem_tekrari` ön kontrolüdür;
    burada ölçülen odur. Kaldırılırsa ikinci istek adedi artırmaya çalışır ve
    `uq_package_scan_idem` ihlaliyle patlar — sessiz çift sayım imkânsızdır,
    ama kullanıcı 409 yerine ham hata görür.
    """
    servis = _servis()
    aid = await fab.admin()
    _oid, paket, ean = await _acik_paket(fab, servis, aid, adet=2)

    for _ in range(4):
        async with AsyncSessionLocal() as s:
            sonuc = await servis.scan(
                s, paket.id, code=ean, admin_id=aid, idempotency_key="tek-anahtar"
            )
        assert sonuc.result == "OK"
    assert sonuc.replayed is True
    # Tekrar yanıtı hangi satırı işaret ettiğini KAYBETMEZ (P2 temizliği):
    # ekran "hangi kalem okutuldu" bandını tekrar yanıtında da çizebilmeli.
    assert sonuc.order_item_id == paket.items[0].order_item_id

    async with AsyncSessionLocal() as s:
        taze = await servis.get_package(s, paket.id)
        olay = (
            await s.execute(
                text(
                    "SELECT count(*) FROM package_scan_events "
                    "WHERE package_id = :p AND event_type = 'SCAN'"
                ),
                {"p": paket.id},
            )
        ).scalar_one()
    assert taze.items[0].scanned_qty == 1, "tekrar kazanılmamış adedi kalıcı kıldı"
    assert olay == 1


@pytest.mark.asyncio
async def test_C5_mark_handed_over_TEKRARI_FALSE_DONER(fab):
    """`mark_handed_over` **kendi** tekrar guard'ını taşır — doğrudan ölçülür.

    `handover_scan` içindeki `if not ...` dalı o akıştan ulaşılamaz (erken
    dönüş daha önce yakalar), ama fonksiyon public'tir ve commit 6/7'deki saha
    ekranı ya da ileride bir toplu zimmet onu doğrudan çağırabilir. Guard
    kaldırılırsa ikinci bir `HANDOVER` olayı yazılır.
    """
    servis = _servis()
    aid = await fab.admin()
    kurye = await fab.kurye()
    _oid, paket, _stop, _run = await _sahada_paket(fab, servis, aid, kurye)

    from models.packing import OrderPackage

    async with AsyncSessionLocal() as s:
        orm = await s.get(OrderPackage, paket.id)
        ikinci = await servis.mark_handed_over(
            s, orm, courier_id=kurye, actor=f"courier:{kurye}"
        )
        assert ikinci is False, "zaten zimmetli paket ikinci kez zimmetlendi"
        await s.rollback()

    async with AsyncSessionLocal() as s:
        adet = (
            await s.execute(
                text(
                    "SELECT count(*) FROM package_scan_events "
                    "WHERE package_id = :p AND event_type = 'HANDOVER'"
                ),
                {"p": paket.id},
            )
        ).scalar_one()
    assert adet == 1


@pytest.mark.asyncio
async def test_C5_ADMIN_ZIMMETI_KURYEYI_TURDAN_DOLDURUR(fab):
    """ADMIN kurye adına zimmetlerse `handed_to_courier_id` BOŞ KALMAZ.

    Operatör kurye adına okutabilir (sözleşme §6). Kurye kimliği boş kalsaydı
    geri dönüş kuyruğu "hangi kuryede" sorusunu cevaplayamazdı — TB-7'nin
    engellemek istediği tam olarak budur.
    """
    servis = _servis()
    aid = await fab.admin()
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    oid, paket, _ean = await _packed_paket(fab, servis, aid)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run, [oid])

    async with AsyncSessionLocal() as s:
        gorunum = await delivery_service.handover_scan(
            s, paket.qr_payload, courier_id=None, actor=f"admin:{aid}",
            actor_role=1, actor_id=aid,
        )
    assert gorunum.handed_to_courier_id == kurye, "admin zimmetinde kurye kaybolmuş"
    assert f"admin:{aid}" == gorunum.handed_over_by_actor

    async with AsyncSessionLocal() as s:
        kuyruk = {k.package_id: k for k in await servis.return_queue(s)}
    assert paket.id not in kuyruk   # henüz geri beklenmiyor
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run)
        stop_id = (
            await s.execute(
                text("SELECT id FROM delivery_stops WHERE order_id = :o"), {"o": oid}
            )
        ).scalar_one()
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(
            s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK"
        )
    async with AsyncSessionLocal() as s:
        kuyruk = {k.package_id: k for k in await servis.return_queue(s)}
    assert kuyruk[paket.id].courier_id == kurye, "geri dönüş kuyruğunda kurye yok"


# ══════════════════ P2-F · repack STALE ═════════════════════════════════════


@pytest.mark.asyncio
async def test_P2F_repack_BAYAT_PAKETI_YENIDEN_DAGITIMA_VERMEZ(fab):
    """`repack` de `items_fingerprint` denetler (P2-F kararı).

    `repack` `prepared_at`'i yeniden damgalar, yani paketi `eligible_orders`
    kuyruğuna GERİ SOKAR. Paket araçtayken siparişin kalem listesi değişmişse
    kutunun içi artık siparişe karşılık gelmez ve müşteriye yanlış içerik
    gider. `complete` bunu zaten koruyordu; `repack` korumuyordu.
    """
    servis = _servis()
    aid = await fab.admin()
    kurye = await fab.kurye()
    oid, paket, stop_id, _run = await _sahada_paket(fab, servis, aid, kurye)
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(
            s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK"
        )
    async with AsyncSessionLocal() as s:
        await servis.return_in(s, paket.id, admin_id=aid)

    # Sipariş içeriği değişti (bugün ucu yok; nöbetçinin ölçtüğü tam bu yarın).
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE order_items SET quantity = 5 WHERE order_id = :o"), {"o": oid}
        )
        await s.commit()

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await servis.repack(s, paket.id, admin_id=aid)
    assert hata.value.status_code == 409
    assert "STALE" in str(hata.value.detail).upper()

    # Bayat paket dağıtıma GİRMEDİ.
    async with AsyncSessionLocal() as s:
        taze = await servis.get_package(s, paket.id)
        uygun = {o.order_id for o in await delivery_service.eligible_orders(s)}
    assert taze.status == "RETURNED"
    assert oid not in uygun
    assert await fab.prepared_at(oid) is None


@pytest.mark.asyncio
async def test_P2F_repack_ICERIK_DEGISMEDIYSE_calisir(fab):
    """Ters prova: nöbetçi yalnız DEĞİŞİKLİKTE kırmalı, her repack'te değil."""
    servis = _servis()
    aid = await fab.admin()
    kurye = await fab.kurye()
    oid, paket, stop_id, _run = await _sahada_paket(fab, servis, aid, kurye)
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(
            s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK"
        )
    async with AsyncSessionLocal() as s:
        await servis.return_in(s, paket.id, admin_id=aid)
    async with AsyncSessionLocal() as s:
        sonuc = await servis.repack(s, paket.id, admin_id=aid)
    assert sonuc.status == "PACKED"
    assert await fab.prepared_at(oid) is not None
