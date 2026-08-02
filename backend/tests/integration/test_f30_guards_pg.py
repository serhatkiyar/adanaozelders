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

import contextlib
import datetime
import re
import typing

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import event, text

from core.database import AsyncSessionLocal, engine
from models.store import Order
from services import delivery_service, order_service
from tests.integration.f30_factory import PaketFabrikasi


#: Kuyruğu OKUMA izni. HTTP düğümleri gerçek izin zinciriyle koşar; "servis
#: çağırdım, çalıştı" kabul edilmez (kök `CLAUDE.md` §B).
VIEW_IZNI = "packing.view"


def _servis():
    from services import packing_service

    return packing_service


def _bas(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def fab(pg) -> PaketFabrikasi:
    f = PaketFabrikasi()
    try:
        yield f
    finally:
        await f.temizle()


@pytest.fixture
async def client():
    """Gerçek ASGI istemcisi — doğrulama/yetki zinciri atlanmaz."""
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest.fixture
async def kur(pg):
    """Gerçek admin + gerçek rol + gerçek izin (kardeş dosyanın kurulumu).

    Kurulum sınıfı kopyalanmaz: iki kopya er ya da geç ayrışır ve biri sessizce
    yanlış izin kümesiyle koşar.
    """
    from tests.integration.test_f30_packing_api_pg import Kurulum

    k = Kurulum()
    try:
        yield k
    finally:
        await k.temizle()


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
            await servis.void(s, paket.id, admin_id=aid, reason="Kutu yırtıldı",
                izin_dogrula=servis.izin_zaten_dogrulandi,
            )

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
                await servis.void(s, paket.id, admin_id=aid, reason=gerekce,
                izin_dogrula=servis.izin_zaten_dogrulandi,
            )
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
        sonuc = await servis.void(s, paket.id, admin_id=aid, reason="  Kutu yırtıldı  ",
                izin_dogrula=servis.izin_zaten_dogrulandi,
            )
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


# ══════ Commit 5 · elle hazırlama yolu KALDIRILDI · VOID kör noktası ════════
#
# Commit 4'te bu bölümde `mark_prepared`'ın paketleme istasyonunu ezmesini
# engelleyen üç düğüm vardı. Commit 5'te elle hazırlama uçları ve iş mantığı
# **tamamen silindi**, yani o guard'ın koruduğu yol artık YOK. Düğümler
# silinmedi, ölçtükleri iddia bir üst seviyeye taşındı: "elle hazır işaretleme
# engellenir" yerine **"elle hazır işaretleme diye bir şey yoktur"**.


@pytest.mark.asyncio
async def test_C5_ELLE_HAZIRLAMA_IS_MANTIGI_YOK():
    """`delivery_service.mark_prepared` ARTIK YOK (sözleşme §3.5).

    Uçları kaldırıp servis fonksiyonunu bırakmak, bir sonraki router'ın onu
    yeniden yayımlamasını bir satırlık iş yapardı. Yapısal eşi:
    `test_f30_packing_contract.py::test_mark_prepared_KALDIRILDI`.
    """
    for ad in ("mark_prepared", "unmark_prepared", "unprepare_order"):
        assert not hasattr(delivery_service, ad), f"geri gelmiş: {ad}"


@pytest.mark.asyncio
@pytest.mark.parametrize("durum", ["VOID", "RETURNED", "RETURN_PENDING"])
async def test_C5_PAKET_GECMISI_OLAN_SIPARIS_ESKI_YOLA_DONEMEZ(fab, durum):
    """Bayat bir `prepared_at` damgası, paketi hazır OLMAYAN siparişi dağıtıma sokamaz.

    Commit 4 denetiminin "VOID kör noktası" bulgusu: canlı paket sorgusu
    terminal paketleri görmez, yani `VOID` bir paket "canlı paket yok"
    demektir. Elle hazırlama dururken şu yol açıktı:

        paket VOID → elle "Hazır" → eligible → add_stops → start_run
        → paket OLMADAN, hiç okutulmadan SHIPPED.

    Elle uçlar kaldırıldı, yani damganın ÜRETİMDEKİ tek kaynağı artık
    `complete`/`repack` (yapısal nöbetçi:
    `test_f30_packing_contract.py::test_prepared_at_YAZICILARI_ALLOWLISTTE`).
    Bu düğüm **ikinci savunma hattını** ölçer: F30 ÖNCESİNDEN kalan ya da elle
    sızmış bayat bir damga da işe yaramamalı. Damga bu yüzden bilinçli olarak
    ham SQL ile basılır — normal akışın üretemediği veriyi test etmenin başka
    yolu yoktur ve guard tam olarak o veri için vardır.

    ⚠️ İzolasyon: 409'un **paket** guard'ından geldiği, gövdede paket kodunun
    aranmasıyla kanıtlanır. Eski sürüm bu ayrımı yapmıyordu ve 409'u
    "henüz hazırlanmadı" kontrolünden alıyordu (P2-C ile aynı kusur).
    """
    servis = _servis()
    aid = await fab.admin()
    kurye = await fab.kurye()

    if durum == "VOID":
        oid, paket, _ean = await _packed_paket(fab, servis, aid)
        async with AsyncSessionLocal() as s:
            await servis.void(s, paket.id, admin_id=aid, reason="Kutu ezildi",
                izin_dogrula=servis.izin_zaten_dogrulandi,
            )
    elif durum == "RETURNED":
        oid, paket, stop_id, _run = await _sahada_paket(fab, servis, aid, kurye)
        async with AsyncSessionLocal() as s:
            await delivery_service.fail_stop(
                s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK"
            )
        async with AsyncSessionLocal() as s:
            await servis.return_in(s, paket.id, admin_id=aid)
    else:
        oid, paket, stop_id, _run = await _sahada_paket(fab, servis, aid, kurye)
        async with AsyncSessionLocal() as s:
            await delivery_service.fail_stop(
                s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK"
            )

    # Bayat damga: F30 öncesinden kalmış / elle sızmış bir `prepared_at`.
    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "UPDATE orders SET prepared_at = now(), prepared_by = 'bayat-veri' "
                "WHERE id = :o"
            ),
            {"o": oid},
        )
        await s.commit()

    # Ön koşullar: sipariş dağıtıma UYGUN görünüyor (PAID, hazır damgalı,
    # açık durağı yok) — 409'un başka bir kontrolden gelmediğinin kanıtı.
    durum_o, odeme = await fab.siparis_durumu(oid)
    assert (durum_o, odeme) == ("PAID", "PAID")
    assert await fab.prepared_at(oid) is not None
    async with AsyncSessionLocal() as s:
        assert await delivery_service._has_open_stop(s, oid) is False

    # 1) Dağıtım kuyruğu onu GÖSTERMEZ.
    async with AsyncSessionLocal() as s:
        uygun = {o.order_id for o in await delivery_service.eligible_orders(s)}
    assert oid not in uygun, f"{durum} paketli sipariş bayat damgayla eligible oldu"

    # 2) Elle tura eklenmek istenirse PAKET guard'ı reddeder.
    yeni_tur = await fab.tur(courier_id=kurye)
    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await delivery_service.add_stops(s, yeni_tur, [oid])
    assert hata.value.status_code == 409
    detay = str(hata.value.detail)
    if durum == "VOID":
        assert "çözülmüş" in detay, f"409 paket guard'ından gelmiyor: {detay}"
    else:
        assert paket.code in detay and durum in detay, (
            f"409 paket guard'ından gelmiyor: {detay}"
        )

    async with AsyncSessionLocal() as s:
        durak = (
            await s.execute(
                text("SELECT count(*) FROM delivery_stops WHERE run_id = :r"),
                {"r": yeni_tur},
            )
        ).scalar_one()
    assert durak == 0


@pytest.mark.asyncio
async def test_C5_return_in_HAZIR_DAMGASINI_DUSURUR(fab):
    """`return_in` `prepared_at`'i SIFIRLAR — yeniden dağıtım onayı `repack`'tir.

    Commit 5'te bulunan tutarsızlık: iki geri dönüş yolu aynı fiziksel gerçeği
    anlatmasına rağmen farklı davranıyordu. `fail_stop` `roll_promise` ile
    damgayı düşürüyordu; `cancel_run` düşürmüyordu. Sonuç: turu iptal edilmiş
    bir siparişte `return_in` sonrası paket `RETURNED` (yani operatör onayı
    BEKLİYOR) olduğu hâlde sipariş damgalı kalıyor ve `repack` OLMADAN yeniden
    dağıtıma girebiliyordu — sözleşme §3.5'in "sıra atlanamaz" kuralının
    delindiği yer.

    Bu yol `cancel_run` üzerinden kurulur (damgayı düşürmeyen yol); ham SQL
    YOKTUR, yani ölçülen şey gerçek akıştır.
    """
    servis = _servis()
    aid = await fab.admin()
    kurye = await fab.kurye()
    oid, paket, _stop, run = await _sahada_paket(fab, servis, aid, kurye)
    assert await fab.prepared_at(oid) is not None, "zimmet öncesi damga yok"

    async with AsyncSessionLocal() as s:
        await delivery_service.cancel_run(s, run)
    assert await fab.prepared_at(oid) is not None, (
        "cancel_run damgayı düşürüyor — bu testin ölçtüğü yol kapanmış"
    )

    async with AsyncSessionLocal() as s:
        await servis.return_in(s, paket.id, admin_id=aid)
    assert await fab.prepared_at(oid) is None, (
        "return_in damgayı düşürmedi — paket operatör onayı olmadan dağıtıma girer"
    )
    async with AsyncSessionLocal() as s:
        uygun = {o.order_id for o in await delivery_service.eligible_orders(s)}
    assert oid not in uygun

    # Onay `repack`'tir: damga yeniden basılır ve sipariş kuyruğa döner.
    async with AsyncSessionLocal() as s:
        await servis.repack(s, paket.id, admin_id=aid)
    assert await fab.prepared_at(oid) is not None
    async with AsyncSessionLocal() as s:
        uygun = {o.order_id for o in await delivery_service.eligible_orders(s)}
    assert oid in uygun


@pytest.mark.asyncio
async def test_C5_HAZIR_PAKET_TURA_GIREBILIR(fab):
    """Ters prova: guard yalnız HAZIR OLMAYAN paketi engellemeli.

    Aksi hâlde yukarıdaki düğüm, `add_stops`/`eligible_orders` tamamen
    bozulduğu hâlde de yeşil kalırdı.
    """
    servis = _servis()
    aid = await fab.admin()
    kurye = await fab.kurye()
    oid, _paket, _ean = await _packed_paket(fab, servis, aid)
    async with AsyncSessionLocal() as s:
        uygun = {o.order_id for o in await delivery_service.eligible_orders(s)}
    assert oid in uygun
    run = await fab.tur(courier_id=kurye)
    async with AsyncSessionLocal() as s:
        tur = await delivery_service.add_stops(s, run, [oid])
    assert [d.order_id for d in tur.stops] == [oid]


@pytest.mark.asyncio
async def test_C5_VOID_PAKETLI_SIPARIS_ZIMMETSIZ_GONDERILEMEZ(fab):
    """Uçtan uca: `VOID` paketli sipariş hiçbir yoldan okutulmadan SHIPPED olamaz.

    Durak **elle** (ham SQL ile) tura sokulsa bile — yani `add_stops` guard'ı
    atlansa bile — `start_run` onu zimmetsiz sayar ve turu 409'lar. İki katman
    da ölçülür, çünkü tek katmanlı koruma koruma değildir.
    """
    servis = _servis()
    aid = await fab.admin()
    kurye = await fab.kurye()
    oid, paket, _ean = await _packed_paket(fab, servis, aid)
    async with AsyncSessionLocal() as s:
        await servis.void(s, paket.id, admin_id=aid, reason="Kutu ezildi",
                izin_dogrula=servis.izin_zaten_dogrulandi,
            )

    run = await fab.tur(courier_id=kurye)
    # `add_stops` guard'ını ATLA: durağı doğrudan yaz (kötü niyetli/eski veri).
    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "INSERT INTO delivery_stops (run_id, order_id, sequence, qr_token, "
                "status, created_at, updated_at) "
                "VALUES (:r, :o, 1, :t, 'PENDING', now(), now())"
            ),
            {"r": run, "o": oid, "t": "elle-" + str(oid)},
        )
        await s.commit()

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await delivery_service.start_run(s, run)
    assert hata.value.status_code == 409
    assert str(oid) in str(hata.value.detail), "eksik paket listesinde sipariş yok"

    durum, _odeme = await fab.siparis_durumu(oid)
    assert durum == "PAID", "zimmetsiz sipariş dağıtıma çıktı"

    # Doğru yol: yeniden paketle → tura ekle → zimmetle → tur başlar.
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("DELETE FROM delivery_stops WHERE run_id = :r"), {"r": run}
        )
        await s.commit()
    pid = paket.items[0].product_id
    async with AsyncSessionLocal() as s:
        yeni = await servis.open_package(s, oid, admin_id=aid)
    async with AsyncSessionLocal() as s:
        ean = (
            await s.execute(
                text("SELECT barcode FROM products WHERE id = :i"), {"i": pid}
            )
        ).scalar_one()
        await servis.scan(s, yeni.id, code=ean, admin_id=aid)
    async with AsyncSessionLocal() as s:
        yeni = await servis.complete(s, yeni.id, admin_id=aid)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run, [oid])
    async with AsyncSessionLocal() as s:
        await delivery_service.handover_scan(
            s, yeni.qr_payload, courier_id=kurye, actor=f"courier:{kurye}"
        )
    async with AsyncSessionLocal() as s:
        tur = await delivery_service.start_run(s, run)
    assert tur.status == "ACTIVE"
    assert (await fab.siparis_durumu(oid))[0] == "SHIPPED"


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


# ══════ Commit 6 · RETURNED çıkmazı (commit 5 denetiminin regresyonu) ═══════


@pytest.mark.asyncio
async def test_C6_RETURNED_PAKET_ILK_PAKETLEME_KUYRUGUNDA_GORUNMEZ(fab):
    """`RETURNED` paketli sipariş "topla ve paketle" kuyruğunda GÖRÜNMEZ.

    Commit 5 denetiminin doğruladığı çıkmaz: `return_in` paketi `RETURNED`
    yapıp `prepared_at`'i sıfırlıyor, sipariş de normal hazırlama kuyruğuna
    düşüyordu. Oysa paket **rafta hazır duruyor**; doğru işlem `repack`'tir.
    Operatör kuyrukta "Paketle" görüp `open_package` çağırınca mevcut
    `RETURNED` paketi geri alıyor, `complete` ise 409 veriyordu — ekranda
    hiçbir yere varmayan bir döngü.

    Ölçülen üç şey:
      1. `prep_queue`'da (hazırlama istasyonu) GÖRÜNMEZ,
      2. `packing_queue`'da (paketleme ekranı) GÖRÜNÜR **ve** satır paketin
         `RETURNED` olduğunu söyler — ekran doğru eylemi ancak böyle önerebilir,
      3. `eligible_orders`'ta da yok (repack onayı verilmedi).
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
        hazirlama = {o.order_id for o in await delivery_service.prep_queue(s)}
        uygun = {o.order_id for o in await delivery_service.eligible_orders(s)}
        kuyruk, _toplam = await servis.packing_queue(s)
    assert oid not in hazirlama, "RETURNED paket 'topla ve paketle' kuyruğunda"
    assert oid not in uygun, "repack onayı olmadan dağıtıma uygun görünüyor"

    satir = next((r for r in kuyruk if r.order_id == oid), None)
    assert satir is not None, "paketleme kuyruğunda da yok — sipariş kayboldu"
    assert satir.package is not None and satir.package.status == "RETURNED", (
        "satır paketin durumunu taşımıyor — ekran yanlış eylemi önerir"
    )
    assert satir.package.code == paket.code


@pytest.mark.asyncio
async def test_C6_RETURNED_PAKET_REPACK_ILE_COZULUR(fab):
    """Ters prova: çıkmazın çıkışı `repack`'tir ve gerçekten çalışır.

    Yukarıdaki düğüm tek başına "sipariş hiçbir yerde görünmüyor" hâlinde de
    yeşil kalırdı. Burada aynı siparişin `repack` ile `PACKED` olup dağıtım
    kuyruğuna döndüğü ve paketleme kuyruğundan düştüğü ölçülür.
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
        sonuc = await servis.repack(s, paket.id, admin_id=aid)
    assert sonuc.status == "PACKED"

    async with AsyncSessionLocal() as s:
        uygun = {o.order_id for o in await delivery_service.eligible_orders(s)}
        kuyruk, _t = await servis.packing_queue(s)
    assert oid in uygun
    assert oid not in {r.order_id for r in kuyruk}, "iş bitti ama kuyrukta duruyor"


@pytest.mark.asyncio
async def test_C6_PAKETLEME_KUYRUGU_UC_ISI_AYIRT_EDER(fab):
    """Kuyruk üç işi de gösterir ve her satır hangi eylemin doğru olduğunu söyler.

    * paketi yok        → `package is None`  (yeni paket aç)
    * `OPEN` paketi var → `package.status == "OPEN"` (devam et)
    * `PACKED` paketi var → kuyrukta YOK (iş bitti, dağıtım kuyruğunda)
    """
    servis = _servis()
    aid = await fab.admin()

    p1, _s1, _e1 = await fab.barkodlu_urun(stock=10)
    yeni_oid = await fab.fiziksel_siparis(kalemler=[(p1, 1)])

    p2, _s2, _e2 = await fab.barkodlu_urun(stock=10)
    acik_oid = await fab.fiziksel_siparis(kalemler=[(p2, 1)])
    async with AsyncSessionLocal() as s:
        await servis.open_package(s, acik_oid, admin_id=aid)

    bitmis_oid, _paket, _ean = await _packed_paket(fab, servis, aid)

    async with AsyncSessionLocal() as s:
        kuyruk, toplam = await servis.packing_queue(s)
    satirlar = {r.order_id: r for r in kuyruk}
    assert toplam == len(kuyruk)

    assert yeni_oid in satirlar and satirlar[yeni_oid].package is None
    assert satirlar[yeni_oid].item_count == 1
    assert satirlar[yeni_oid].items and satirlar[yeni_oid].items[0][1] == 1

    assert acik_oid in satirlar
    assert satirlar[acik_oid].package is not None
    assert satirlar[acik_oid].package.status == "OPEN"

    assert bitmis_oid not in satirlar, "tamamlanmış paket kuyrukta kalmış"


@pytest.mark.asyncio
async def test_SIRA_YARDIMCISI_TEKILLESTIRIR_VE_SIRALAR(pg):
    """`_lock_orders_ascending` yinelenen `order_id`'leri teker ve sıralar.

    Dönüş değeri sözleşmenin bir parçasıdır: aynı sipariş için iki durak
    bulunduğunda satır iki kez kilitlenmeye çalışılmaz. Yeniden giriş
    zararsızdır ama sıra iddiasını okunmaz kılar ve "hangi sırayla kilitledik"
    sorusunun cevabını belirsizleştirir.
    """
    from services import delivery_service

    async with AsyncSessionLocal() as s:
        sonuc = await delivery_service._lock_orders_ascending(s, [])
        assert sonuc == []
        # Gerçek satır gerekmez: kilit sorgusu eşleşmeyen id'de de çalışır.
        sonuc = await delivery_service._lock_orders_ascending(
            s, [999_000_003, 999_000_001, 999_000_003, 999_000_002]
        )
    assert sonuc == [999_000_001, 999_000_002, 999_000_003], sonuc


# ══════ Commit 7 · /packing/queue sözleşmesi (bağımsız denetimin P2'leri) ════
#
# Dört bulgu, dört ayrı iddia:
#   P2-1 sayfalama yok + `total == len(items)` totolojisi,
#   P2-2 satır başına `live_package` (N+1),
#   P2-3 çıplak `str` durum + istemcinin iş akışını TAHMİN etmesi,
#   P2-4 paketi hiç olmamış ama turda bekleyen F30 öncesi sipariş.


async def _kuyruk_satiri(servis, order_id: int):
    """Kuyruktaki BİR satır (yoksa None) — sayfa tavanına takılmadan.

    Sayfalama geldiği için kuyruk artık ilk 50 satırla sınırlı döner; test
    verisi kuyruğun sonuna eklendiğinde varsayılan sayfada görünmeyebilir.
    Bu yardımcı hedef siparişi `order_id` ile arar, "ilk sayfada mı" diye
    sormaz — aksi hâlde testler kuyruğun DOLULUĞUNA bağlı olarak kırılırdı.
    """
    async with AsyncSessionLocal() as s:
        satirlar, _toplam = await servis.packing_queue(s, limit=200)
    return next((r for r in satirlar if r.order_id == order_id), None)


@contextlib.contextmanager
def _sorgu_sayaci():
    """Engine üzerinden geçen GERÇEK ifadeleri (+parametrelerini) toplar.

    Mock yok: kayıt `before_cursor_execute`'tan, yani Postgres'e gönderilen
    metnin kendisinden gelir. `pool_pre_ping`'in "SELECT 1"i bu olaydan geçmez
    (ham DBAPI üzerinde koşar), yine de her ölçüm ısıtılmış bir session'da
    yapılır ki sayaç bağlantı kurulum gürültüsünü değil yalnız sorguyu görsün.
    """
    ifadeler: list[tuple[str, object]] = []

    def _kaydet(conn, cursor, statement, parameters, context, executemany):
        ifadeler.append((statement, parameters))

    event.listen(engine.sync_engine, "before_cursor_execute", _kaydet)
    try:
        yield ifadeler
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", _kaydet)


async def _kuyruk_sayfa_sqli(servis, **cagri) -> tuple[str, list]:
    """Kuyruğun SİPARİŞ sorgusunun Postgres'e giden hâli: (metin, parametreler).

    Sayfa tavanını "200 satır üretip sayarak" ölçmek gerçekçi değildi (test
    veritabanında o kadar kuyruk satırı yok ve üretmek suite'i dakikalarca
    şişirirdi) — o hâlde iddia sessizce totolojik oluyordu: tavan kaldırılsa da
    yeşil kalıyordu (mutasyon provası bunu YAKALADI ve test bu yüzden
    güçlendirildi). Burada ölçülen şey gönderilen SQL'in kendisidir.
    """
    async with AsyncSessionLocal() as s:
        await s.execute(text("SELECT 1"))
        with _sorgu_sayaci() as ifadeler:
            await servis.packing_queue(s, **cagri)
    sayfa = [
        (metin, params)
        for metin, params in ifadeler
        if "FROM orders" in metin and "count(" not in metin
    ]
    assert len(sayfa) == 1, f"sipariş sayfası sorgusu bulunamadı: {sayfa}"
    metin, params = sayfa[0]
    return metin, list(params or [])


def _limit_offset(metin: str, params: list) -> tuple[int, int]:
    """Gönderilen cümledeki `LIMIT`/`OFFSET` değerleri.

    Parametre listesinin SONUNU okumak yetmez: `IN (...)` yüklemleri asyncpg'de
    çalışma anında genişler ve kendi değerlerini listenin sonuna ekler. Bu
    yüzden yer tutucu numarası (`$n`) cümlenin metninden çözülür.
    """
    esles = re.search(
        r"LIMIT \$(\d+)(?:::\w+)? OFFSET \$(\d+)(?:::\w+)?", metin
    )
    assert esles is not None, f"cümlede parametreli LIMIT/OFFSET yok: {metin[-200:]}"
    return params[int(esles.group(1)) - 1], params[int(esles.group(2)) - 1]


async def _kuyruk_sorgu_sayisi(servis) -> int:
    async with AsyncSessionLocal() as s:
        await s.execute(text("SELECT 1"))          # bağlantıyı ısıt (sayım dışı)
        with _sorgu_sayaci() as ifadeler:
            await servis.packing_queue(s, limit=200)
    return len(ifadeler)


@pytest.mark.asyncio
async def test_C7_KUYRUK_SAYFALARI_KAYIT_TEKRARLATMAZ(fab):
    """`total` süzülmüş toplamdır; sayfalar arasında kayıt tekrarı/kayması olmaz.

    Eski uç `{items, total}` dönüyordu ama `total = len(items)`'ti — yani onu
    doğrulayan iddia (`toplam == len(kuyruk)`) TOTOLOJİKTİ: uç bütün tabloyu
    tek istekte döksün ya da yarısını kaybetsin, o assert yeşil kalırdı.
    Burada ölçülen üç şey:

    1. `total`, sayfa uzunluğundan BAĞIMSIZ olarak taban+3 artar (limit=1 iken
       bile 3 yeni kaydı bildirir),
    2. limit=1 ile bütün kuyruk gezildiğinde hiçbir `order_id` iki kez GÖRÜNMEZ
       ve üç yeni sipariş kaybolmaz,
    3. sıra deterministiktir: üç siparişin söz günü VE oluşturma anı bilinçli
       olarak EŞİTLENİR, yani sırayı belirleyen tek şey `Order.id`
       bağlayıcısıdır. O bağlayıcı olmasaydı sıra Postgres'in keyfine kalırdı
       ve sayfalar arasında kayma bir gün üretimde görülürdü.
    """
    servis = _servis()
    async with AsyncSessionLocal() as s:
        _bos, taban = await servis.packing_queue(s, limit=1)

    oidler: list[int] = []
    for _ in range(3):
        pid, _sku, _ean = await fab.barkodlu_urun(stock=10)
        oidler.append(await fab.fiziksel_siparis(kalemler=[(pid, 1)]))

    esit_an = datetime.datetime.now(datetime.timezone.utc)
    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "UPDATE orders SET created_at = :t, promised_delivery_date = :g "
                "WHERE id = ANY(:i)"
            ),
            {"t": esit_an, "g": datetime.date.today(), "i": oidler},
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        ilk_sayfa, toplam = await servis.packing_queue(s, limit=1)
    assert len(ilk_sayfa) == 1, "limit=1 sayfası bir satırdan uzun"
    assert toplam == taban + 3, (
        f"`total` süzülmüş toplamı bildirmiyor (beklenen {taban + 3}, gelen {toplam})"
    )
    assert toplam <= 200, "test veritabanında beklenmedik kadar kuyruk satırı var"

    gorulen: list[int] = []
    for ofset in range(toplam):
        async with AsyncSessionLocal() as s:
            sayfa, sayfa_toplami = await servis.packing_queue(s, limit=1, offset=ofset)
        assert sayfa_toplami == toplam, "toplam sayfaya göre değişiyor"
        assert len(sayfa) == 1, f"offset={ofset} sayfası boş/uzun"
        gorulen.append(sayfa[0].order_id)

    assert len(set(gorulen)) == len(gorulen), (
        f"sayfalar arasında kayıt tekrarı: {gorulen}"
    )
    assert set(oidler) <= set(gorulen), "sayfalanan gezinti bazı siparişleri atladı"

    # Tavanın SON sayfası da doğru davranmalı: aşan offset boş sayfa döner ama
    # toplamı yalanlamaz.
    async with AsyncSessionLocal() as s:
        tasan, tasan_toplam = await servis.packing_queue(s, limit=1, offset=toplam)
    assert tasan == []
    assert tasan_toplam == toplam


@pytest.mark.asyncio
async def test_C7_KUYRUK_SERVIS_TAVANI_ROUTERDAN_BAGIMSIZ(fab):
    """Servis kendi tavanını AYRICA uygular — tek katmanlı koruma koruma değildir.

    Router `Query(le=200)` ile sınırlar, ama servisi doğrudan çağıran bir arka
    plan işi ya da yarın yazılacak ikinci bir uç o sınırın dışındadır.

    İddia **gönderilen SQL üzerinden** kurulur: `limit=10_000` istendiğinde
    Postgres'e giden cümlede `LIMIT` yer alır ve değeri `QUEUE_MAX_LIMIT`'tir.
    Satır sayarak ölçmek burada işe yaramaz — test veritabanında 200'den fazla
    kuyruk satırı yoktur, dolayısıyla tavan kaldırılsa bile satır sayısı aynı
    kalır (bu tam olarak yaşandı; mutasyon provası testi yakalayıp
    güçlendirtti).
    """
    servis = _servis()
    pid, _sku, _ean = await fab.barkodlu_urun(stock=10)
    await fab.fiziksel_siparis(kalemler=[(pid, 1)])

    metin, params = await _kuyruk_sayfa_sqli(servis, limit=10_000)
    assert _limit_offset(metin, params) == (servis.QUEUE_MAX_LIMIT, 0), (
        "servis tavanı uygulanmadı: "
        f"{_limit_offset(metin, params)} ≠ ({servis.QUEUE_MAX_LIMIT}, 0)"
    )

    # Taban da servis tarafında: geçersiz değer sayfayı BOŞALTMAZ.
    m0, p0 = await _kuyruk_sayfa_sqli(servis, limit=0, offset=-5)
    assert _limit_offset(m0, p0) == (1, 0), (
        f"limit=0/offset=-5 tabana çekilmedi: {_limit_offset(m0, p0)}"
    )

    async with AsyncSessionLocal() as s:
        sifir, _t = await servis.packing_queue(s, limit=0)
        eksi, _t2 = await servis.packing_queue(s, limit=1, offset=-5)
    assert len(sifir) == 1, "limit=0 sayfayı boşaltmamalı, tabana çekilmeli"
    assert len(eksi) == 1, "negatif offset tabana çekilmeli"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "sorgu",
    [
        "limit=0",
        "limit=-1",
        "limit=201",
        "limit=abc",
        "offset=-1",
        "offset=100001",
        "offset=x",
    ],
)
async def test_C7_KUYRUK_GECERSIZ_SAYFALAMA_422(client, kur, sorgu):
    """Geçersiz `limit`/`offset` **422**'dir — sessizce tabana çekilmez.

    Sessiz düzeltme, istemcinin istediğiyle aldığının farklı olmasına yol açar:
    `limit=1000` isteyen ekran 200 satır alıp "hepsi bu" sanar. Doğrulama
    gerçek dependency zinciriyle ölçülür; yanındaki 200'lük ters prova 422'nin
    yetkiden ya da başka bir kontrolden gelmediğini kanıtlar.
    """
    _aid, token = await kur.admin(izinler=[VIEW_IZNI])
    r = await client.get(f"/api/v1/packing/queue?{sorgu}", headers=_bas(token))
    assert r.status_code == 422, f"{sorgu} kabul edildi: {r.status_code} {r.text}"

    ok = await client.get(
        "/api/v1/packing/queue?limit=1&offset=0", headers=_bas(token)
    )
    assert ok.status_code == 200, f"geçerli sayfa da reddediliyor: {ok.text}"
    govde = ok.json()
    assert govde["limit"] == 1 and govde["offset"] == 0
    assert isinstance(govde["total"], int)
    assert len(govde["items"]) <= 1


@pytest.mark.asyncio
async def test_C7_KUYRUK_SORGU_SAYISI_SATIR_SAYISIYLA_ARTMAZ(fab):
    """Sorgu sayısı SABİT: 1 satır ile 5 satır aynı sayıda sorgu üretir.

    Eski hâlde kuyruk satır başına `packing_events.live_package` çağırıyordu
    (25 satır → 29 sorgu ölçüldü). Bu, `eligible_orders`'ta bir kez düzeltilen
    N+1'in aynısıydı; kuyrukta tekrarlanmıştı.

    Ölçüm gerçek engine olayından gelir (`before_cursor_execute`), yani sorgu
    "sayılmış gibi yapılamaz". Üst sınır bilinçli olarak DAR tutulur (≤6):
    gevşek bir tavan (ör. ≤50) N+1'in geri gelmesini 45 satıra kadar
    görmezdi.
    """
    servis = _servis()
    aid = await fab.admin()

    pid, _sku, _ean = await fab.barkodlu_urun(stock=10)
    await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    bir_satir = await _kuyruk_sorgu_sayisi(servis)

    for _ in range(4):
        p, _s, _e = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(p, 1)])
    # Satırlardan biri CANLI paketli olsun: özet yolu da ölçülsün, yoksa test
    # "paket hiç okunmuyor" hâlinde de yeşil kalırdı.
    async with AsyncSessionLocal() as s:
        await servis.open_package(s, oid, admin_id=aid)

    bes_satir = await _kuyruk_sorgu_sayisi(servis)

    async with AsyncSessionLocal() as s:
        satirlar, _t = await servis.packing_queue(s, limit=200)
    assert len(satirlar) >= 5, "ölçüm için yeterli satır oluşmamış"
    assert any(r.package is not None for r in satirlar), "canlı paketli satır yok"

    assert bir_satir == bes_satir, (
        f"sorgu sayısı satır sayısıyla artıyor (N+1): 1 satır → {bir_satir}, "
        f"5 satır → {bes_satir}"
    )
    assert bes_satir <= 6, f"kuyruk çok fazla sorgu üretiyor: {bes_satir}"


@pytest.mark.asyncio
async def test_C7_NEXT_ACTION_UC_DURUMU_AYIRT_EDER(fab):
    """Satır hangi eylemin doğru olduğunu AÇIKÇA söyler (istemci tahmin etmez).

    * paketi yok            → `OPEN_NEW_PACKAGE`
    * `OPEN` paketi var     → `CONTINUE_PACKING`
    * `RETURNED` paketi var → `REPACK_RETURNED`

    Üçü de gerçek servis yollarıyla kurulur (ham SQL ile durum yazılmaz), yani
    ölçülen şey gerçek akışın ürettiği satırdır.
    """
    servis = _servis()
    aid = await fab.admin()
    kurye = await fab.kurye()

    p1, _s1, _e1 = await fab.barkodlu_urun(stock=10)
    yeni_oid = await fab.fiziksel_siparis(kalemler=[(p1, 1)])

    p2, _s2, _e2 = await fab.barkodlu_urun(stock=10)
    acik_oid = await fab.fiziksel_siparis(kalemler=[(p2, 1)])
    async with AsyncSessionLocal() as s:
        await servis.open_package(s, acik_oid, admin_id=aid)

    donen_oid, paket, stop_id, _run = await _sahada_paket(fab, servis, aid, kurye)
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(
            s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK"
        )
    async with AsyncSessionLocal() as s:
        await servis.return_in(s, paket.id, admin_id=aid)

    yeni = await _kuyruk_satiri(servis, yeni_oid)
    acik = await _kuyruk_satiri(servis, acik_oid)
    donen = await _kuyruk_satiri(servis, donen_oid)
    assert yeni is not None and acik is not None and donen is not None

    assert yeni.package is None
    assert yeni.next_action == "OPEN_NEW_PACKAGE"
    assert acik.package is not None and acik.package.status == "OPEN"
    assert acik.next_action == "CONTINUE_PACKING"
    assert donen.package is not None and donen.package.status == "RETURNED"
    assert donen.next_action == "REPACK_RETURNED", (
        "geri gelen paket için 'yeni paket aç' öneriliyor — commit 5 çıkmazı"
    )

    # Fail-closed: tanınmayan durum eyleme DÖNÜŞMEZ. Varsayılanı "yeni paket aç"
    # yapmak, operatöre aynı ürünleri ikinci kez toplatırdı.
    assert servis.next_action_for("HANDED_OVER") is None
    assert servis.next_action_for("VOID") is None
    assert servis.next_action_for("BILINMEYEN_DURUM") is None


@pytest.mark.asyncio
async def test_C7_LEGACY_ACIK_DURAKLI_SIPARIS_KUYRUKTA_GORUNMEZ(fab):
    """Paketi HİÇ olmamış ama zaten turda bekleyen sipariş kuyruktan ÇIKAR.

    F30 öncesinden kalan sipariş: elle "Hazır" damgalanmış, bir tura eklenmiş,
    paket geçmişi yok. Kuyrukta "Paketle" olarak görünüyordu; operatör paketleyip
    tamamlasa bile durak ZATEN vardı ve zimmetsiz kaldığı için `start_run` bütün
    turu 409'luyordu — sonu çıkmaz olan bir iş öneriliyordu.

    Ayırt edicilik: durak EKLENMEDEN ÖNCE sipariş kuyrukta GÖRÜNÜR; tek fark
    açık durağın varlığıdır. Ayrıca koşulun `delivery_service._has_open_stop`
    ile aynı anlama geldiği doğrudan karşılaştırılır (ikisi sözleşme §3.7
    yüzünden ayrı yazılıdır ve ayrışabilirler).
    """
    servis = _servis()
    kurye = await fab.kurye()
    pid, _sku, _ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)], prepared=True)

    assert await _kuyruk_satiri(servis, oid) is not None, (
        "durak eklenmeden önce de görünmüyor — bu test izole değil"
    )

    run = await fab.tur(courier_id=kurye)
    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "INSERT INTO delivery_stops (run_id, order_id, sequence, qr_token, "
                "status, created_at, updated_at) "
                "VALUES (:r, :o, 1, :t, 'PENDING', now(), now())"
            ),
            {"r": run, "o": oid, "t": "legacy-" + str(oid)},
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        assert await delivery_service._has_open_stop(s, oid) is True
    assert await _kuyruk_satiri(servis, oid) is None, (
        "turda bekleyen paketsiz sipariş paketleme kuyruğunda görünüyor"
    )


@pytest.mark.asyncio
async def test_C7_LEGACY_DURAKSIZ_SIPARIS_KUYRUKTA_GORUNUR(fab):
    """Ters prova: elenen şey AÇIK DURAK, "eski sipariş" değil.

    Aksi hâlde yukarıdaki düğüm, kuyruk bütün legacy siparişleri (hatta hepsini)
    yuttuğu hâlde de yeşil kalırdı. Burada aynı kurulum kullanılır, tek fark
    durağın SONUÇLANMIŞ olmasıdır — sipariş yeniden paketlenebilir ve kuyrukta
    görünmelidir.
    """
    servis = _servis()
    kurye = await fab.kurye()
    pid, _sku, _ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)], prepared=True)

    run = await fab.tur(courier_id=kurye)
    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "INSERT INTO delivery_stops (run_id, order_id, sequence, qr_token, "
                "status, fail_reason, created_at, updated_at) "
                "VALUES (:r, :o, 1, :t, 'FAILED', 'EVDE_YOK', now(), now())"
            ),
            {"r": run, "o": oid, "t": "legacy-kapali-" + str(oid)},
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        assert await delivery_service._has_open_stop(s, oid) is False
    satir = await _kuyruk_satiri(servis, oid)
    assert satir is not None, "sonuçlanmış duraklı sipariş kuyruktan da elenmiş"
    assert satir.next_action == "OPEN_NEW_PACKAGE"


def _literal_degerleri(annotation) -> tuple[str, ...]:
    """`Literal[...]` / `Literal[...] | None` içinden değerleri çıkarır.

    Kaynak metni değil GERÇEK tip nesnesi okunur: şemadaki bir yorum satırı ya
    da docstring'deki örnek küme testi kandıramaz.
    """
    for aday in (annotation, *typing.get_args(annotation)):
        if typing.get_origin(aday) is typing.Literal:
            return typing.get_args(aday)
    raise AssertionError(f"Literal bulunamadı: {annotation!r}")


def test_C7_KUYRUK_DURUM_LITERALI_KURALLARDAN_AYRISAMAZ():
    """Şemadaki durum kümesi ↔ `packing_rules.PACKAGE_STATUSES`: aynı, aynı sırada.

    Şema katmanı `services`'i import EDEMEZ (bağımlılık yönü `services →
    schemas`), bu yüzden sözlük üçüncü kez yazılıdır. Ayrışırsa hata SESSİZ
    değil ama YANLIŞ yerde görünür: uç, DB'nin kabul ettiği bir durumu
    yanıtlarken pydantic doğrulaması patlar ve operatör 500 görür.

    ⚠️ Bu **düşük güçlü** bir sözleşme testidir (kök `CLAUDE.md` §C); davranış
    eşi `test_C7_NEXT_ACTION_UC_DURUMU_AYIRT_EDER`'dir (gerçek uçtan gerçek
    durum döner).
    """
    from schemas.packing import PackageSummaryOut, PackingQueueRowOut
    from services import packing_rules

    durumlar = _literal_degerleri(
        PackageSummaryOut.model_fields["status"].annotation
    )
    assert durumlar == tuple(packing_rules.PACKAGE_STATUSES), (
        f"şema durum kümesi ayrışmış: {durumlar} ≠ "
        f"{tuple(packing_rules.PACKAGE_STATUSES)}"
    )

    # `next_action` da ayrışabilir: servis yeni bir eylem üretip şemaya
    # eklemezse yanıt 500 olur.
    from services import packing_service

    semadaki = set(
        _literal_degerleri(PackingQueueRowOut.model_fields["next_action"].annotation)
    )
    uretilen = {packing_service.NEXT_ACTION_OPEN} | set(
        packing_service._PAKET_DURUM_EYLEMI.values()
    )
    assert semadaki == uretilen, (
        f"next_action sözlüğü ayrışmış: şema {sorted(semadaki)} ≠ "
        f"servis {sorted(uretilen)}"
    )
