"""F30 kurye zimmetinin İDEMPOTENSİ ve hata yüzeyi — GERÇEK HTTP + GERÇEK PostgreSQL.

Zimmet, F30'un tek "geri alınamaz" anıdır: paket işletmeden çıkar, sipariş
`SHIPPED` olur, müşteriye takip linki SMS'i ve "kuryemiz yola çıktı" bildirimi
gider. Bunların hepsi **aynı transaction'da** doğar, yani ikinci bir okutma
ikinci bir SMS demektir — ve SMS geri alınamaz.

Kardeş dosya `test_f30_packing_api_pg.py::test_ZIMMET_TEKRARI_HTTP_TEK_YAN_ETKI`
üç yan etkiyi (durum geçişi, olay, bildirim) sayıyordu. Bağımsız denetim geri
kalanların sayılmadığını buldu: **audit satırı**, **outbox (SMS) satırı**,
**takip numarasının DEĞERİ** ve **zimmet kuryesinin kimliği**. Bu dosya sekiz
yan etkinin her birini tek tek sayar; "bir tanesi tekrarlanıyor ama toplam yine
de doğru görünüyor" hâli imkânsız olsun diye hiçbiri toplu iddiaya gömülmez.

İkinci bölüm hata yüzeyidir. Kalıcı QR'ın bedeli (sözleşme §7 S4) etiketlerin
kopyalanabilmesidir; bu yüzden **dört ayrı ret sebebi tek bir gövdeyle** yanıt
vermelidir. Gövde farkı, elinde yalnız bir paket kimliği olan birine "bu paket
var / bu tur güncel" bilgisini sızdırırdı — ve o bilgi kapı taramasının ilk
adımıdır.
"""
from __future__ import annotations

import asyncio
import uuid

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.database import AsyncSessionLocal
from services import delivery_service
from tests.integration.f30_factory import PaketFabrikasi

VIEW, PACK, MANAGE = "packing.view", "packing.pack", "packing.manage"
#: Saha router'ı (`/delivery/*`) admin için görev izni ister; kurye için rol.
DELIVERY_VIEW, DELIVERY_MANAGE = "delivery.view", "delivery.manage"

#: Kilit yarışında askıda kalmak yerine KIRILMAK için — bkz.
#: `test_f30_packing_race_pg.py` (aynı gerekçe, aynı değer).
KILIT_ZAMAN_ASIMI = "4s"


def _bas(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _servis():
    from services import packing_service

    return packing_service


@pytest.fixture
async def client():
    """Gerçek ASGI istemcisi — doğrulama/yetki zinciri atlanmaz."""
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest.fixture
async def fab(pg) -> PaketFabrikasi:
    f = PaketFabrikasi()
    try:
        yield f
    finally:
        await f.temizle()


@pytest.fixture
async def kur(pg):
    """Gerçek admin + gerçek rol + gerçek izin.

    Kurulum sınıfı KOPYALANMAZ: iki kopya er ya da geç ayrışır ve biri sessizce
    yanlış izin kümesiyle koşar (kardeş dosyaların ortak kararı).
    """
    from tests.integration.test_f30_packing_api_pg import Kurulum

    k = Kurulum()
    try:
        yield k
    finally:
        await k.temizle()


# ══════════════════ Kurulum yardımcıları ════════════════════════════════════


async def _packed_paket(client, token: str, fab: PaketFabrikasi, *, adet: int = 1):
    """HTTP üzerinden tam doğrulanmış (PACKED) paket. `(order_id, paket_gövdesi)`

    Paket gerçek uçlardan geçer (`open` → `scan` → `complete`): ham SQL ile
    yazılmış bir "PACKED" satırı, zimmetin ön koşullarını (fingerprint,
    `prepared_at`, canlı paket tekilliği) hiç kurmamış olurdu.
    """
    pid, _sku, ean = await fab.barkodlu_urun(stock=10 + adet)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, adet)])
    r = await client.post(f"/api/v1/packing/orders/{oid}/open", headers=_bas(token))
    assert r.status_code == 200, r.text
    paket = r.json()
    for _ in range(adet):
        r = await client.post(
            f"/api/v1/packing/packages/{paket['id']}/scan",
            json={"code": ean, "idempotency_key": uuid.uuid4().hex},
            headers=_bas(token),
        )
        assert r.json()["result"] == "OK", r.text
    r = await client.post(
        f"/api/v1/packing/packages/{paket['id']}/complete", headers=_bas(token)
    )
    assert r.status_code == 200, r.text
    return oid, r.json()


async def _durak_id(order_id: int) -> int:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(
                text("SELECT id FROM delivery_stops WHERE order_id = :o"),
                {"o": order_id},
            )
        ).scalar_one()


async def _yan_etkiler(order_id: int, package_id: int) -> dict:
    """Zimmetin ürettiği her yan etkinin GERÇEK sayısı + değeri.

    Her satır ayrı ayrı sayılır. Toplu bir "hepsi bir" iddiası, bir tanesi iki
    kez yazılırken bir başkası hiç yazılmadığında da doğru görünebilirdi.
    """
    async with AsyncSessionLocal() as s:
        siparis = (
            await s.execute(
                text(
                    "SELECT status, tracking_no, client_id FROM orders WHERE id = :o"
                ),
                {"o": order_id},
            )
        ).one()
        paket = (
            await s.execute(
                text(
                    "SELECT status, handed_over_at, handed_to_courier_id, "
                    "handed_over_by_actor FROM order_packages WHERE id = :p"
                ),
                {"p": package_id},
            )
        ).one()
        sayilar = {
            "shipped_gecisi": (
                await s.execute(
                    text(
                        "SELECT count(*) FROM order_status_history "
                        "WHERE order_id = :o AND new_status = 'SHIPPED'"
                    ),
                    {"o": order_id},
                )
            ).scalar_one(),
            "handover_olayi": (
                await s.execute(
                    text(
                        "SELECT count(*) FROM package_scan_events "
                        "WHERE package_id = :p AND event_type = 'HANDOVER'"
                    ),
                    {"p": package_id},
                )
            ).scalar_one(),
            "audit": (
                await s.execute(
                    text(
                        "SELECT count(*) FROM audit_logs "
                        "WHERE action = 'package.handover' "
                        "AND target_type = 'order_package' AND target_id = :p"
                    ),
                    {"p": package_id},
                )
            ).scalar_one(),
            "outbox_sms": (
                await s.execute(
                    text(
                        "SELECT count(*) FROM outbox_events "
                        "WHERE kind = 'sms:tracking_link' "
                        "AND payload ->> 'order_id' = :o"
                    ),
                    {"o": str(order_id)},
                )
            ).scalar_one(),
            "bildirim": (
                await s.execute(
                    text(
                        "SELECT count(*) FROM notifications "
                        "WHERE user_id = :c AND role_id = 3 AND message LIKE :k"
                    ),
                    {"c": siparis.client_id, "k": f"%#{order_id} %dağıtımda%"},
                )
            ).scalar_one(),
        }
    return {
        **sayilar,
        "siparis_durumu": siparis.status,
        "tracking_no": siparis.tracking_no,
        "paket_durumu": paket.status,
        "handed_over_at": paket.handed_over_at,
        "handed_to_courier_id": paket.handed_to_courier_id,
        "handed_over_by_actor": paket.handed_over_by_actor,
    }


# ══════════════════ İdempotency: üç okutma, bir yan etki ════════════════════


@pytest.mark.asyncio
async def test_AYNI_ETIKET_UC_KEZ_OKUTULUNCA_HER_YAN_ETKI_TAM_BIR_KEZ(
    client, kur, fab
):
    """Sekiz yan etkinin her biri ayrı ayrı sayılır ve hepsi **tam bir** olmalı.

    Gerçek senaryo tek: el terminali yanıtı görmeden kurye etiketi ikinci kez
    okutur, ya da ağ tekrarı isteği yeniden gönderir. Tekrarlanan her yan etki
    ayrı bir zarar üretir:

    * ikinci `SHIPPED` geçişi → sipariş geçmişi yalan söyler,
    * ikinci takip numarası → müşterinin elindeki link ölür,
    * ikinci `HANDOVER` olayı → append-only defterde olmayan bir fiziksel olay,
    * ikinci audit satırı → denetimde "iki kez zimmetlendi" görünür,
    * ikinci outbox satırı → müşteriye **ikinci SMS** (geri alınamaz),
    * ikinci bildirim → panelde çift satır,
    * tazelenen `handed_over_at` → "paket ne zaman çıktı" cevabı kayar,
    * kaybolan `handed_to_courier_id` → geri dönüş kuyruğu kuryeyi bulamaz.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK])
    kurye = await fab.kurye()
    hesap_id, kurye_token = await fab.kurye_hesabi(kurye)
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _packed_paket(client, token, fab)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run, [oid])
    stop_id = await _durak_id(oid)

    yanitlar = []
    for _ in range(3):
        r = await client.post(
            "/api/v1/delivery/handover/scan",
            json={"payload": paket["qr_payload"]},
            headers=_bas(kurye_token),
        )
        assert r.status_code == 200, r.text
        yanitlar.append(r.json())

    # (1) Yanıt semantiği: üç yanıt da AYNI paketi, aynı durumda, aynı damgayla
    # bildirir. Tekrarın "başarılı ama farklı" görünmesi, ekranın ikinci
    # okutmayı yeni bir iş sanmasına yol açardı.
    for i, govde in enumerate(yanitlar):
        assert govde["id"] == paket["id"], f"{i}. yanıt başka paketi döndü"
        assert govde["status"] == "HANDED_OVER", f"{i}. yanıt: {govde['status']}"
        assert govde["handed_to_courier_id"] == kurye
    assert len({g["handed_over_at"] for g in yanitlar}) == 1, (
        f"tekrar zimmet damgasını tazeledi: {[g['handed_over_at'] for g in yanitlar]}"
    )

    # (2) Yan etkiler — her biri ayrı ayrı.
    olcum = await _yan_etkiler(oid, paket["id"])
    assert olcum["shipped_gecisi"] == 1, olcum
    assert olcum["handover_olayi"] == 1, olcum
    assert olcum["audit"] == 1, olcum
    assert olcum["outbox_sms"] == 1, olcum
    assert olcum["bildirim"] == 1, olcum
    assert olcum["siparis_durumu"] == "SHIPPED"
    assert olcum["paket_durumu"] == "HANDED_OVER"

    # (3) Takip numarası ÜRETİLDİ ve DEĞERİ doğru. Yalnız "boş değil" demek
    # yetmez: numara durak/tur kimliğini taşır ve ikinci bir okutma onu
    # yeniden hesaplarsa (ör. paket ikinci turda okutulunca) müşterinin
    # elindeki link başka bir kayda bakar.
    assert olcum["tracking_no"] == f"ELDEN-R{run}-S{stop_id}", olcum["tracking_no"]

    # (4) Damga tek: DB'deki değer ilk yanıtınkiyle aynı ve tekrarlarda ölçülen
    # değer değişmedi.
    assert olcum["handed_to_courier_id"] == kurye, "zimmet kuryesi kaybolmuş"
    # `handed_to_courier_id` kurye PROFİLİNİ (`couriers.id`), aktör dizgisi ise
    # okutan HESABI (`courier_accounts.id`) taşır. İkisi bilinçli olarak farklı
    # uzaylardır: "hangi araç/kişi taşıyor" ile "kim okuttu" aynı soru değildir
    # (operatör kurye adına okutabilir). Test ikisini de kendi kimliğiyle
    # doğrular; birini diğerinin yerine yazan bir regresyon burada kırılır.
    assert olcum["handed_over_by_actor"] == f"courier:{hesap_id}", (
        f"aktör dizgisi hesabı değil başka bir kimliği taşıyor: "
        f"{olcum['handed_over_by_actor']}"
    )

    # (5) Dördüncü okutmadan sonra da hiçbir sayı artmıyor (tekrar guard'ı
    # "ilk üçte" değil, süresiz geçerli).
    r = await client.post(
        "/api/v1/delivery/handover/scan",
        json={"payload": paket["qr_payload"]},
        headers=_bas(kurye_token),
    )
    assert r.status_code == 200, r.text
    assert await _yan_etkiler(oid, paket["id"]) == olcum, "dördüncü okutma iz bıraktı"


@pytest.mark.asyncio
async def test_ES_ZAMANLI_IKI_OKUTMA_DA_TEK_YAN_ETKI_URETIR(client, kur, fab):
    """Aynı etiketi iki eşzamanlı istek okutursa yan etki yine **bir** olmalı.

    Sıralı tekrar `paket.status == "HANDED_OVER"` erken dönüşüyle kapanır; ama
    iki istek aynı anda geldiğinde ikisi de paketi `PACKED` görebilir. Onları
    ayıran tek şey `Order` satır kilididir (kanonik sıra
    `Order → OrderPackage → DeliveryStop`): kilidi kaybeden istek beklemek
    zorundadır ve serbest kaldığında **taze** durumu okur
    (`populate_existing=True`).

    Kilit sırası bozulursa bu düğüm askıda kalmaz, KIRILIR: her görev kendi
    session'ında `lock_timeout` ile başlar ve deadlock (40P01) / kilit zaman
    aşımı (55P03) yutulmaz.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK])
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _packed_paket(client, token, fab)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run, [oid])
    stop_id = await _durak_id(oid)

    async def _gorev():
        s = AsyncSessionLocal()
        await s.execute(text(f"SET LOCAL lock_timeout = '{KILIT_ZAMAN_ASIMI}'"))
        try:
            return await delivery_service.handover_scan(
                s,
                paket["qr_payload"],
                courier_id=kurye,
                actor=f"courier:{kurye}",
                actor_role=5,
                actor_id=kurye,
            )
        finally:
            await s.close()

    sonuclar = await asyncio.gather(_gorev(), _gorev(), return_exceptions=True)
    for sonuc in sonuclar:
        if not isinstance(sonuc, BaseException):
            continue
        kod = getattr(getattr(sonuc, "orig", None), "sqlstate", None) or ""
        if kod == "40P01":
            pytest.fail(f"DEADLOCK (40P01): {sonuc}")
        if kod == "55P03":
            pytest.fail(f"KİLİT ZAMAN AŞIMI (55P03) — kilit sırası bozuk: {sonuc}")
        raise sonuc
    assert all(s.status == "HANDED_OVER" for s in sonuclar), (
        f"eşzamanlı okutmanın biri zimmeti tamamlamadı: {sonuclar}"
    )

    olcum = await _yan_etkiler(oid, paket["id"])
    assert olcum["shipped_gecisi"] == 1, olcum
    assert olcum["handover_olayi"] == 1, olcum
    assert olcum["audit"] == 1, olcum
    assert olcum["outbox_sms"] == 1, olcum
    assert olcum["bildirim"] == 1, olcum
    assert olcum["tracking_no"] == f"ELDEN-R{run}-S{stop_id}"
    assert olcum["handed_to_courier_id"] == kurye


@pytest.mark.asyncio
async def test_ADMIN_ZIMMETINDE_DE_TURUN_KURYESI_YAZILIR(client, kur, fab):
    """Operatör kurye adına okutabilir; kurye kimliği yine de KAYBOLMAZ.

    `courier_id=None` yolu (ADMIN) sahiplik süzgeci uygulamaz, yani
    `handed_to_courier_id` doğrudan istekten gelemez — turun kuryesinden
    okunur. Boş kalsaydı geri dönüş kuyruğu "paket hangi kuryede" sorusunu
    cevaplayamazdı (TB-7). Burada ölçülen şey gerçek HTTP yoludur: ADMIN
    token'ı ile saha ucu.
    """
    _aid, token = await kur.admin(
        izinler=[VIEW, PACK, DELIVERY_VIEW, DELIVERY_MANAGE]
    )
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _packed_paket(client, token, fab)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run, [oid])
    stop_id = await _durak_id(oid)

    r = await client.post(
        "/api/v1/delivery/handover/scan",
        json={"payload": paket["qr_payload"]},
        headers=_bas(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["handed_to_courier_id"] == kurye, "admin zimmetinde kurye boş"

    olcum = await _yan_etkiler(oid, paket["id"])
    assert olcum["handed_to_courier_id"] == kurye
    assert olcum["handed_over_by_actor"] == f"admin:{_aid}"
    assert olcum["tracking_no"] == f"ELDEN-R{run}-S{stop_id}"
    assert olcum["audit"] == 1, olcum
    assert olcum["outbox_sms"] == 1, olcum


# ══════════════════ Hata yüzeyi: dört ret, tek gövde ════════════════════════


@pytest.mark.asyncio
async def test_DORT_RET_SEBEBI_DE_AYNI_404_GOVDESIYLE_YANITLANIR(client, kur, fab):
    """Yabancı paket · geçmiş tur · bozuk token · olmayan paket → **aynı gövde**.

    Dördü farklı sebeplerdir ama hepsi aynı şeyi söylemelidir. Gövde farkı bir
    ORAKÜL kurardı: elinde kopya bir etiket olan kişi, yanıt metnine bakarak
    "paket var ama benim değil" ile "böyle paket yok"u ayırt eder, oradan da
    hangi kimliklerin gerçek olduğunu tarayabilirdi (sözleşme §7 S4).

    Karşılaştırma tek bir iddiada yapılır: dört gövdenin kümesi TEK ELEMANLI
    olmalıdır. Ayrı ayrı "== beklenen metin" demek, metin değiştiğinde dördünü
    birden gevşetmeye davet ederdi.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK, MANAGE])

    # (a) Yabancı kurye: paket A'nın turunda, okutan B.
    kurye_a = await fab.kurye()
    kurye_b = await fab.kurye()
    _hb, token_b = await fab.kurye_hesabi(kurye_b)
    run_a = await fab.tur(courier_id=kurye_a)
    await fab.tur(courier_id=kurye_b)          # B'nin de güncel bir turu VAR
    oid_a, paket_a = await _packed_paket(client, token, fab)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run_a, [oid_a])

    # (b) Geçmiş tur: kuryenin KENDİ paketi, ama tur iptal edilmiş.
    kurye_c = await fab.kurye()
    _hc, token_c = await fab.kurye_hesabi(kurye_c)
    run_c = await fab.tur(courier_id=kurye_c)
    oid_c, paket_c = await _packed_paket(client, token, fab)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run_c, [oid_c])
    async with AsyncSessionLocal() as s:
        await delivery_service.cancel_run(s, run_c)

    gercek_token = paket_a["qr_payload"].split(":")[2]
    denemeler = {
        "yabanci_kurye": (token_b, paket_a["qr_payload"]),
        "gecmis_tur": (token_c, paket_c["qr_payload"]),
        "bozuk_token": (token_b, f"PKG1:{paket_a['id']}:{gercek_token[:-1]}x"),
        "olmayan_paket": (token_b, f"PKG1:999000777:{gercek_token}"),
    }
    govdeler = {}
    for ad, (tok, yuk) in denemeler.items():
        r = await client.post(
            "/api/v1/delivery/handover/scan",
            json={"payload": yuk},
            headers=_bas(tok),
        )
        assert r.status_code == 404, f"{ad}: {r.status_code} {r.text}"
        govdeler[ad] = r.json()

    assert len({str(g) for g in govdeler.values()}) == 1, (
        f"404 gövdeleri farklı — ret sebebi sızıyor: {govdeler}"
    )
    # Gövde paketin varlığını/durumunu SÖYLEMEZ.
    metin = str(govdeler["yabanci_kurye"])
    for sizinti in ("PACKED", "RETURN_PENDING", "HANDED_OVER", str(paket_a["id"])):
        assert sizinti not in metin, f"404 gövdesinde {sizinti!r} sızıyor: {metin}"

    # Yan etkisizlik: hiçbir paket zimmetlenmedi, hiçbir sipariş dağıtıma çıkmadı.
    for oid, paket in ((oid_a, paket_a), (oid_c, paket_c)):
        olcum = await _yan_etkiler(oid, paket["id"])
        assert olcum["shipped_gecisi"] == 0, olcum
        assert olcum["handover_olayi"] == 0, olcum
        assert olcum["audit"] == 0, olcum
        assert olcum["outbox_sms"] == 0, olcum
        assert olcum["tracking_no"] is None
        assert olcum["handed_over_at"] is None

    # Ters prova: uç ölü değil — A'nın kuryesi aynı etiketi okutunca çalışır.
    _ha, token_a = await fab.kurye_hesabi(kurye_a)
    r = await client.post(
        "/api/v1/delivery/handover/scan",
        json={"payload": paket_a["qr_payload"]},
        headers=_bas(token_a),
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "HANDED_OVER"


@pytest.mark.asyncio
@pytest.mark.parametrize("durum", ["OPEN", "RETURN_PENDING"])
async def test_ZIMMETE_UYGUN_OLMAYAN_PAKET_409_ve_DURUMU_SOYLER(
    client, kur, fab, durum
):
    """Sahibi okutuyorsa 409 alır ve **sebebini öğrenir** — 404 değil.

    Sıra bilinçlidir: sahiplik (404) durum kontrolünden (409) ÖNCE gelir.
    Yabancıya hiçbir şey söylenmez, ama paketi gerçekten taşıyacak kuryeye
    "kutun eksik" ya da "bu paket geri bekleniyor" denmelidir; aksi hâlde kurye
    depoda ne yapacağını bilemez ve tur başlangıcında toplu bir 409 ile
    karşılaşır.

    * `OPEN` — kutu son anda ezildi, operatör `void` edip yeni paket açtı.
    * `RETURN_PENDING` — paket kuryede kaldı; önce depoda okutulmalı
      (`return_in`), "geri döndü" VARSAYILAMAZ (sözleşme §3.5 / G5).
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK, MANAGE])
    kurye = await fab.kurye()
    _hid, kurye_token = await fab.kurye_hesabi(kurye)
    run = await fab.tur(courier_id=kurye)
    oid, ilk = await _packed_paket(client, token, fab)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run, [oid])

    if durum == "OPEN":
        r = await client.post(
            f"/api/v1/packing/packages/{ilk['id']}/void",
            json={"reason": "Kutu ezildi"},
            headers=_bas(token),
        )
        assert r.status_code == 200, r.text
        paket = (
            await client.post(
                f"/api/v1/packing/orders/{oid}/open", headers=_bas(token)
            )
        ).json()
    else:
        paket = ilk
        r = await client.post(
            "/api/v1/delivery/handover/scan",
            json={"payload": paket["qr_payload"]},
            headers=_bas(kurye_token),
        )
        assert r.status_code == 200, r.text
        async with AsyncSessionLocal() as s:
            await delivery_service.start_run(s, run)
        async with AsyncSessionLocal() as s:
            await delivery_service.fail_stop(
                s, await _durak_id(oid), reason="Kimse yoktu", reason_code="EVDE_YOK"
            )

    # Ön koşul: paket GERÇEKTEN beklenen durumda (409 başka yerden gelmesin).
    servis = _servis()
    async with AsyncSessionLocal() as s:
        taze = await servis.get_package(s, paket["id"])
    assert taze.status == durum

    onceki = await _yan_etkiler(oid, paket["id"])
    r = await client.post(
        "/api/v1/delivery/handover/scan",
        json={"payload": paket["qr_payload"]},
        headers=_bas(kurye_token),
    )
    assert r.status_code == 409, f"{durum}: {r.status_code} {r.text}"
    detay = r.json()["detail"]
    assert durum in detay and "PACKED" in detay, (
        f"409 beklenen/mevcut durumu söylemiyor: {detay}"
    )
    assert taze.code in detay, f"409 hangi pakete ait olduğunu söylemiyor: {detay}"

    # Reddedilen istek hiçbir sayacı oynatmadı.
    assert await _yan_etkiler(oid, paket["id"]) == onceki, "409 iz bıraktı"


@pytest.mark.asyncio
async def test_ZIMMETLENMEMIS_PAKETLI_TUR_BASLATILAMAZ(client, kur, fab):
    """Kurye eksik paketle yola çıkamaz — ve hangi siparişin eksik olduğunu görür.

    İkinci savunma hattı: `handover/scan` her paket için tek tek çalışır,
    `start_run` ise turun BÜTÜNÜNÜ denetler. Tek katmanlı koruma koruma
    değildir; zimmet ucu bir gün gevşerse tur başlatma hâlâ tutmalıdır.
    Ölçüm gerçek HTTP ile yapılır (admin planlama ucu).
    """
    _aid, token = await kur.admin(
        izinler=[VIEW, PACK, DELIVERY_VIEW, DELIVERY_MANAGE]
    )
    kurye = await fab.kurye()
    _hid, kurye_token = await fab.kurye_hesabi(kurye)
    run = await fab.tur(courier_id=kurye)
    o1, p1 = await _packed_paket(client, token, fab)
    o2, _p2 = await _packed_paket(client, token, fab)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run, [o1, o2])

    r = await client.post(
        "/api/v1/delivery/handover/scan",
        json={"payload": p1["qr_payload"]},
        headers=_bas(kurye_token),
    )
    assert r.status_code == 200, r.text

    r = await client.post(f"/api/v1/delivery/runs/{run}/start", headers=_bas(token))
    assert r.status_code == 409, r.text
    assert str(o2) in r.text, f"eksik paketin siparişi yanıtta yok: {r.text}"

    # Tur PLANLI kaldı ve zimmetli sipariş de dağıtıma ÇIKMADI değil — çıkışı
    # zaten zimmet yazdı (sözleşme §3.4); ölçülen şey turun başlamamasıdır.
    async with AsyncSessionLocal() as s:
        tur_durumu = (
            await s.execute(
                text("SELECT status FROM delivery_runs WHERE id = :r"), {"r": run}
            )
        ).scalar_one()
    assert tur_durumu == "PLANNED"
    assert (await fab.siparis_durumu(o2))[0] == "PAID", "zimmetsiz sipariş SHIPPED"

    # Ters prova: eksik paket de zimmetlenince tur BAŞLAR (guard "her turu
    # reddet" hâlinde de yeşil kalmasın).
    r = await client.post(
        "/api/v1/delivery/handover/scan",
        json={"payload": _p2["qr_payload"]},
        headers=_bas(kurye_token),
    )
    assert r.status_code == 200, r.text
    r = await client.post(f"/api/v1/delivery/runs/{run}/start", headers=_bas(token))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ACTIVE"


@pytest.mark.asyncio
async def test_BOZUK_QR_SERVIS_KATMANINDA_DA_404(fab):
    """Ayrıştırılamayan yük servis katmanında da 404 — 500 değil.

    HTTP şeması `payload`'ı yalnız uzunluk olarak doğrular (`min_length=1`),
    yani biçim denetimi servise aittir. Ayrıştırma hatası bir istisnaya
    dönüşseydi kurye ekranı "beklenmeyen hata" gösterirdi ve gövdede yığın izi
    riski doğardı.
    """
    kurye = await fab.kurye()
    await fab.tur(courier_id=kurye)
    for yuk in ("", "PKG1", "PKG1:abc:def", "PKG9:1:x", "1:token", "   "):
        with pytest.raises(HTTPException) as hata:
            async with AsyncSessionLocal() as s:
                await delivery_service.handover_scan(
                    s, yuk, courier_id=kurye, actor=f"courier:{kurye}"
                )
        assert hata.value.status_code == 404, f"{yuk!r} → {hata.value.status_code}"


# ══════════════ Zimmet kapısı: zimmetsiz paket TESLİM EDİLEMEZ ══════════════
#
# Commit 7 denetiminde bulunan gerçek üretim açığı: kapı taraması
# (`POST /delivery/scan`) paket durumunu kontrol ediyordu ama **teslimi
# bitiren üç uç etmiyordu**. QR'ı hiç okutmadan doğrudan teslim çağıran bir
# istemci, kutu HÂLÂ RAFTAYKEN siparişi `DELIVERED` yapabiliyordu ve hata
# sessizdi: `on_package_delivered` geçişi reddedip `False` dönüyor, sipariş
# yine de teslim sayılıyor, müşteriye "teslim edildi" e-postası gidiyordu.
#
# Ekran tarafı (saha ekranının paket kapısı) deliği kapatıyor ama tek savunma
# hattı arayüz olamaz: uç kimlik doğrulamalı herkese açıktır.


async def _teslime_hazir_durak(client, token, fab, *, pref: str | None = None):
    """AKTİF turda, PACKED paketi olan, OTP'si hazır, **ZİMMETSİZ** bir durak.

    Kurulum dolambaçlı görünüyor ama senaryonun gerçek yolu bu: saha aksiyonu
    yalnız `ACTIVE` turda çalışır (`_require_field_stop`) ve `start_run` zaten
    zimmetsiz paketle turu başlatmaz. Yani zimmetsiz bir paket ancak **tur
    çıktıktan sonra eklenen durakla** sahaya düşebilir — `add_stops` bilinçli
    olarak `ACTIVE` turu da kabul eder (gün içinde yetişen sipariş). O durak
    için kurye kutuyu depodan almadan doğrudan teslim çağırabilir; guard'ın
    kapattığı delik tam olarak burasıdır.

    Kısayol (turu ham SQL ile `ACTIVE` yapmak) bilinçli olarak seçilmedi:
    ulaşılamayan bir hâli test etmek, guard'ı gerçekte ölçmemek olurdu.
    """
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    # 1) Turu gerçek yoldan sahaya çıkar: ilk sipariş zimmetlenir.
    ilk_oid, ilk_paket = await _packed_paket(client, token, fab)
    _hid, kurye_token = await fab.kurye_hesabi(kurye)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run, [ilk_oid])
    r = await client.post(
        "/api/v1/delivery/handover/scan",
        json={"payload": ilk_paket["qr_payload"]},
        headers=_bas(kurye_token),
    )
    assert r.status_code == 200, r.text
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run)

    # 2) Gün içinde yetişen sipariş: aktif tura eklenir ama ZİMMETLENMEZ.
    oid, paket = await _packed_paket(client, token, fab)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run, [oid])
    stop_id = await _durak_id(oid)
    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "UPDATE delivery_stops SET otp_hash = :h, otp_sent_at = now(), "
                "photo_url = 'private/pod/test.jpg' WHERE id = :i"
            ),
            {"h": delivery_service.hash_otp("123456"), "i": stop_id},
        )
        if pref is not None:
            await s.execute(
                text(
                    "UPDATE orders SET delivery_pref = :p, "
                    "delivery_pref_note = 'kapici Ahmet Bey' WHERE id = :o"
                ),
                {"p": pref, "o": oid},
            )
        await s.commit()
    # Kurye token'ı da döner: aynı kuryeye ikinci hesap açmak
    # `uq_courier_accounts_courier_active`'i ihlal eder.
    return oid, paket, stop_id, kurye, kurye_token


async def _siparis_ve_durak_durumu(order_id: int, stop_id: int) -> tuple[str, str]:
    async with AsyncSessionLocal() as s:
        siparis = (
            await s.execute(
                text("SELECT status FROM orders WHERE id = :o"), {"o": order_id}
            )
        ).scalar_one()
        durak = (
            await s.execute(
                text("SELECT status FROM delivery_stops WHERE id = :i"), {"i": stop_id}
            )
        ).scalar_one()
    return siparis, durak


@pytest.mark.parametrize(
    "yol",
    ["verify_delivery", "override_deliver", "deliver_drop"],
    ids=["otp_ile", "notlu_yonetici", "kapiya_birak"],
)
async def test_ZIMMETSIZ_PAKET_TESLIM_EDILEMEZ(client, kur, fab, yol):
    """Üç teslim ucunun HEPSİ 409 verir ve HİÇBİR yan etki bırakmaz.

    Üçü ayrı ayrı denenir: guard ortak huniye (`_finalize_delivered`) konduğu
    için bir tanesini ölçmek yeterliymiş gibi görünür, ama yarın biri huniyi
    atlayacak şekilde yeniden yazılırsa bunu yalnız kendi düğümü yakalar.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK])
    pref = "KAPIYA_BIRAK" if yol == "deliver_drop" else None
    oid, paket, stop_id, _kurye, _kurye_token = await _teslime_hazir_durak(
        client, token, fab, pref=pref
    )

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            if yol == "verify_delivery":
                await delivery_service.verify_delivery(s, stop_id, code="123456")
            elif yol == "override_deliver":
                await delivery_service.override_deliver(
                    s, stop_id, note="kapida kimse yok"
                )
            else:
                await delivery_service.deliver_drop(s, stop_id)

    assert hata.value.status_code == 409, hata.value.detail
    assert "zimmetlenmemiş" in str(hata.value.detail), hata.value.detail

    siparis, durak = await _siparis_ve_durak_durumu(oid, stop_id)
    assert siparis == "PAID", f"sipariş sessizce ilerledi: {siparis}"
    assert durak == "PENDING", f"durak sessizce kapandı: {durak}"
    async with AsyncSessionLocal() as s:
        assert (
            await s.execute(
                text("SELECT status FROM order_packages WHERE id = :p"),
                {"p": paket["id"]},
            )
        ).scalar_one() == "PACKED"
        # Müşteriye "teslim edildi" e-postası ÜRETİLMEDİ: açığın en pahalı
        # sonucu buydu — kutu raftayken müşteri teslim aldığını sanıyordu.
        assert (
            await s.execute(
                text(
                    "SELECT count(*) FROM outbox_events "
                    "WHERE payload ->> 'order_id' = :o AND kind LIKE '%DELIVERED%'"
                ),
                {"o": str(oid)},
            )
        ).scalar_one() == 0


async def test_ZIMMETLI_PAKET_TESLIM_EDILEBILIR(client, kur, fab):
    """TERS PROVA — guard "her teslimi reddet"e dönüşmedi.

    Bu düğüm olmadan yukarıdaki üçlü, teslimi tamamen kıran bir mutasyonda da
    yeşil kalırdı ve kimse fark etmezdi.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK])
    oid, paket, stop_id, _kurye, kurye_token = await _teslime_hazir_durak(
        client, token, fab
    )
    r = await client.post(
        "/api/v1/delivery/handover/scan",
        json={"payload": paket["qr_payload"]},
        headers=_bas(kurye_token),
    )
    assert r.status_code == 200, r.text

    async with AsyncSessionLocal() as s:
        await delivery_service.verify_delivery(s, stop_id, code="123456")

    siparis, durak = await _siparis_ve_durak_durumu(oid, stop_id)
    assert siparis == "DELIVERED"
    assert durak == "DELIVERED"
    async with AsyncSessionLocal() as s:
        assert (
            await s.execute(
                text("SELECT status FROM order_packages WHERE id = :p"),
                {"p": paket["id"]},
            )
        ).scalar_one() == "DELIVERED"


async def test_PAKETI_HIC_OLMAYAN_SIPARIS_TESLIM_EDILEBILIR(fab):
    """F30 ÖNCESİ sipariş kilitlenmez — fail-open bilinçlidir.

    `order_packages` kaydı hiç olmayan siparişler eski akıştan gelir. Onları da
    zimmet aramaya zorlamak, geçmiş siparişleri teslim EDİLEMEZ hâle getirirdi
    (`dispatchable_package_condition` ile aynı gerekçe). Bu düğüm, guard'ın
    "paket yok" ile "paket var ama kuryede değil" arasındaki farkı gerçekten
    ayırt ettiğini kanıtlar.
    """
    pid, _sku, _ean = await fab.barkodlu_urun(stock=5)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)], prepared=True)
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run, [oid])
        # Paketi hiç olmayan sipariş `start_run`'ın zimmet denetimine de
        # takılmaz (aynı fail-open) — tur gerçek yoldan sahaya çıkar.
        await delivery_service.start_run(s, run)
    stop_id = await _durak_id(oid)
    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "UPDATE delivery_stops SET otp_hash = :h, otp_sent_at = now() "
                "WHERE id = :i"
            ),
            {"h": delivery_service.hash_otp("123456"), "i": stop_id},
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        await delivery_service.verify_delivery(s, stop_id, code="123456")

    siparis, durak = await _siparis_ve_durak_durumu(oid, stop_id)
    assert siparis == "DELIVERED"
    assert durak == "DELIVERED"


async def test_ZIMMET_KAPISI_HTTP_UCUNDA_DA_GECERLI(client, kur, fab):
    """Guard gerçek HTTP yüzeyinde de görünür: 409 + anlamlı gövde.

    Servis düzeyi testi guard'ın VARLIĞINI kanıtlar; bu düğüm kuryenin
    telefonunda gerçekten ne olduğunu — hangi kod, hangi cümle — sabitler.
    """
    # `override-deliver` bilinçli olarak ADMIN-only'dir (OTP'siz teslim bir
    # yetki yükseltme yoludur, `api/routers/delivery.py:72`), bu yüzden kurye
    # token'ı değil `delivery.manage` izinli admin kullanılır.
    _aid, token = await kur.admin(izinler=[VIEW, PACK, DELIVERY_VIEW, DELIVERY_MANAGE])
    _oid, _paket, stop_id, _kurye, _kt = await _teslime_hazir_durak(client, token, fab)
    r = await client.post(
        f"/api/v1/delivery/stops/{stop_id}/override-deliver",
        json={"note": "musteri kapiyi acmadi, komsuya biraktim"},
        headers=_bas(token),
    )
    assert r.status_code == 409, r.text
    assert "zimmetlenmemiş" in r.json()["detail"], r.text
