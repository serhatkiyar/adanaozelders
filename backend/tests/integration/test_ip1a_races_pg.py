"""İP-1a P0-6 — Booking FSM yarışları (GERÇEK PostgreSQL, READ COMMITTED).

## Ölçülen iş kuralı

Para hareketi tetikleyen her geçiş **atomik claim** ile yapılmalıdır: yarışan iki
istekten yalnız biri kazanır, kaybeden hiçbir para hareketi yapmaz ve terminal
bir durumun üzerine yazılmaz (kayıp güncelleme yok).

## Bugünkü gerçek akış

`cancel` ve `complete` atomik claim kullanır (`_claim_transition`,
`services/booking_service.py:74-99`). **`accept` ve `reject` kullanmaz**
(`booking_service.py:413-443`): bellekteki nesne üzerinden `_transition` çağrılır
ve ORM'in ürettiği UPDATE yalnız `WHERE id = ...` ile gider. Aynı boşluk admin
iptalinde de var (`admin_service.py:397-404`). `SELECT ... FOR UPDATE` booking
yollarının hiçbirinde yoktur.

## Determinizm — "bazen kırmızı" test yazmıyoruz

Bu dosyada **hiçbir `asyncio.sleep` yoktur**; ardışıklık tahmin edilmez, açık
`asyncio.Event` sinyalleriyle **ölçülür**. Desen her yarışta aynıdır:

1. Kaybetmesi gereken taraf satırı okur ve `okundu` event'ini set eder.
2. Test `await okundu.wait()` ile o okumanın GERÇEKTEN yapıldığını bilir.
3. Kazanan taraf tam transaction'ını çalıştırıp commit eder.
4. Test kapıyı açar; kaybeden **bayat okumasıyla** yazmaya devam eder.

Bu, gerçek üretim interleaving'inin (oku → başkası commit'ledi → yaz) birebir
modelidir ve her koşuda aynı sonucu verir. `sleep(0.2)` ile kurulan sıra ise iki
yönden hatalıydı: yüklü makinede yetmeyip yarışı hiç kurmayabilir (**yalancı
yeşil**), boş makinede ise gereksiz yere bekletir.

Sağlayıcıda asılı kalan tarafın "oraya vardığı" da tahmin edilmez:
`StubProvider.refund_entered` (`conftest.py`) iade kapısına girildiği anda set
edilir ve testler onu bekler.

## Bayat okuma neden şart

`asyncio.gather(complete(), complete())` biçiminde iki görevi "aynı anda"
başlatmak yarış KURMAZ: ikinci görev satırı ilk görev commit ettikten SONRA
okur, bellekteki FSM zaten 409 verir ve atomik claim hiç sınanmaz. Bu tam olarak
bağımsız denetimin yakaladığı kusurdur (P1-1) — bkz. sözleşme §9c/4.

## Ölçüm

"Sonuçlardan biri oldu" yetersiz bir iddiadır. Her test dört şeyi birlikte
ölçer: izin verilen son durum kümesi · escrow sonucu · sağlayıcı çağrı SAYISI ·
kayıp güncelleme olmadığı.
"""
from __future__ import annotations

import asyncio
import datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.booking import Booking, BookingStatus
from models.client import Client
from models.payment import PaymentStatus
from services import admin_service, booking_service

COZULMUS = (PaymentStatus.REFUNDING, PaymentStatus.REFUNDED)
LOCK_TIMEOUT = "5s"


async def _client_of(s, ders) -> Client:
    return await s.get(Client, ders.client_id)


async def _gecikmeli_okuyucu(
    booking_id: int, *, okundu: asyncio.Event, kapi: asyncio.Event, eylem
):
    """Satırı okur, **okuduğunu bildirir**, kapıyı bekler, sonra eylemi uygular.

    `okundu` bu kurulumun belkemiğidir: testin "kaybeden satırı okudu" bilgisini
    saat yerine **olaydan** almasını sağlar. Onsuz çağıranlar `asyncio.sleep`
    ile tahmin yürütmek zorunda kalıyordu.

    YALNIZ `HTTPException(409)` yutulur. Başka her hata yükseltilir: yarış
    testinde çıplak `except` kullanmak, görevin hiç çalışmamış olmasını da
    "sorun yok" saydırır (bu tuzağa envanter paketinde bir kez düşüldü).

    `SET LOCAL lock_timeout`: kilit sırası hatası olursa test sonsuza dek
    asılmak yerine hızlı ve teşhis edilebilir biçimde düşer.
    """
    async with AsyncSessionLocal() as s:
        await s.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
        booking = await s.get(Booking, booking_id)
        assert booking.status is BookingStatus.PENDING or booking.status is BookingStatus.ACCEPTED
        okundu.set()
        await kapi.wait()
        try:
            await eylem(s, booking)
            await s.commit()
            return True
        except HTTPException as exc:
            if exc.status_code == 409:
                return False
            raise


# ═══════════════════════ KIRMIZI: sözleşme henüz yazılmadı ═══════════════════


async def test_accept_ile_ogrenci_iptali_yarisinda_KAYIP_GUNCELLEME_olmaz(
    ip1a, provider, ip1a_http
):
    """accept ↔ client cancel: iptal edilmiş ders kabul edilmiş hâle geri dönemez.

    `accept` koşulsuz UPDATE yaptığı için (`booking_service.py:413-429`), iptali
    kazanan transaction commit'lense bile accept onun üzerine yazar. Sonuç:
    öğrenci iptal etti, ders ACCEPTED göründü ve `create_for_booking` yeni bir
    ödeme yükümlülüğü doğurdu.
    """
    ders = await ip1a.ders()  # PENDING, henüz ödeme yok
    okundu, kapi = asyncio.Event(), asyncio.Event()

    async def gec_accept(s, booking):
        await booking_service.accept(s, booking)

    accept_gorevi = asyncio.create_task(
        _gecikmeli_okuyucu(ders.booking_id, okundu=okundu, kapi=kapi, eylem=gec_accept)
    )
    await okundu.wait()  # accept satırı GERÇEKTEN okudu ve kapıda bekliyor

    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, ders.booking_id)
        await booking_service.cancel(s, booking, cancelled_by=await _client_of(s, ders))
        await s.commit()

    kapi.set()
    accept_basarili = await accept_gorevi

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.CANCELLED, (
        f"KAYIP GÜNCELLEME: iptal commit'lendikten SONRA accept üzerine yazdı "
        f"(son durum {booking_status.value}). accept koşullu UPDATE kullanmıyor."
    )
    assert not accept_basarili, (
        "iptal edilmiş ders başarıyla kabul edildi — accept 409 vermeliydi"
    )
    assert payment_status is None, (
        f"iptal edilmiş derse ödeme yükümlülüğü doğdu ({payment_status})"
    )


async def test_reject_ile_ogrenci_iptali_yarisinda_TEK_KAZANAN_olur(ip1a, provider, ip1a_http):
    """reject ↔ client cancel: tek kazanan, tek iade, terminal durum ezilmez.

    Kurulum bilinçli olarak **reschedule sonrası** yapılır. Doğrudan `ACCEPTED`
    bir derste bu yarış hiç doğmaz: `_TRANSITIONS[ACCEPTED]` yalnız
    `{COMPLETED, CANCELLED}` içerir (`booking_service.py:58`), yani bellekteki
    `_transition` reject'i zaten 409 ile keser ve test **boş yere yeşil** olurdu.
    Yarışın gerçekten doğduğu tek hâl `PENDING` + `HELD`'dir — ki bu da tam
    olarak P0-1'in ürettiği durumdur.
    """
    ders = await ip1a.odenmis()
    start = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=45)
    r = await ip1a_http.post(
        f"/api/v1/bookings/{ders.booking_id}/reschedule",
        json={
            "start_at": start.isoformat(),
            "end_at": (start + datetime.timedelta(hours=1)).isoformat(),
        },
        headers=ders.client_auth,
    )
    assert r.status_code == 200, r.text
    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.PENDING,
        PaymentStatus.HELD,
    ), "kurulum: reschedule PENDING + HELD üretmedi"
    okundu, kapi = asyncio.Event(), asyncio.Event()

    async def gec_reject(s, booking):
        await booking_service.reject(s, booking)

    reject_gorevi = asyncio.create_task(
        _gecikmeli_okuyucu(ders.booking_id, okundu=okundu, kapi=kapi, eylem=gec_reject)
    )
    await okundu.wait()

    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, ders.booking_id)
        await booking_service.cancel(s, booking, cancelled_by=await _client_of(s, ders))
        await s.commit()

    kapi.set()
    reject_basarili = await reject_gorevi

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.CANCELLED, (
        f"KAYIP GÜNCELLEME: reject, commit'lenmiş iptalin üzerine yazdı "
        f"({booking_status.value}) — reject koşullu UPDATE kullanmıyor"
    )
    assert not reject_basarili, "iptal edilmiş ders reddedilebildi"
    assert payment_status in COZULMUS
    assert len(provider.refund_calls) == 1, (
        f"sağlayıcıya {len(provider.refund_calls)} iade emri gitti (beklenen 1)"
    )


async def test_admin_iptali_ile_tutor_tamamlamasi_yarisinda_TEK_SONUC(ip1a, provider, ip1a_http):
    """admin cancel ↔ tutor complete: hem iade hem hakediş birlikte olamaz.

    Admin yolu read-modify-write olduğu için (`admin_service.py:397-404`) status
    ile para durumu ayrışabilir: complete parayı `RELEASED` yaparken admin aynı
    satıra `CANCELLED` yazabilir. Sonuç: "iptal edilmiş ders, eğitmene ödenmiş para".
    """
    ders = await ip1a.odenmis()
    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(days=40))
    okundu, kapi = asyncio.Event(), asyncio.Event()

    async def gec_admin_iptal(s, booking):
        await admin_service.cancel_booking(s, booking, reason="İP-1a yarış")

    admin_gorevi = asyncio.create_task(
        _gecikmeli_okuyucu(
            ders.booking_id, okundu=okundu, kapi=kapi, eylem=gec_admin_iptal
        )
    )
    await okundu.wait()

    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, ders.booking_id)
        await booking_service.complete(s, booking)
        await s.commit()

    kapi.set()
    await admin_gorevi

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    p = await ip1a.payment(ders.booking_id)

    assert not (p["released_at"] is not None and p["refunded_at"] is not None), (
        "hem release hem refund gerçekleşti: eğitmen kazancı + öğrenci iadesi"
    )
    izinli = {
        (BookingStatus.COMPLETED, PaymentStatus.RELEASED),
        (BookingStatus.CANCELLED, PaymentStatus.REFUNDING),
        (BookingStatus.CANCELLED, PaymentStatus.REFUNDED),
    }
    assert (booking_status, payment_status) in izinli, (
        f"TUTARSIZ SONUÇ: booking={booking_status.value}, ödeme={payment_status}. "
        "Admin iptali claim kullanmadığı için ders durumu ile para durumu ayrıştı."
    )
    assert len(provider.refund_calls) <= 1


async def test_ihtilaf_acilmasi_ile_auto_complete_yarisinda_PARA_ACILMAZ(
    ip1a, provider, ip1a_http
):
    """auto-complete ↔ dispute: ihtilaflı bir ders serbest bırakılmış olamaz.

    Kritik invariant zaman sıralamasından bağımsızdır: hangi taraf kazanırsa
    kazansın, sonuçta `is_disputed=True` VE `released_at` dolu bir kayıt
    kalmamalıdır — o kombinasyon admin'i çaresiz bırakır (iade
    `escrow.py:226-230` ile kalıcı kapalıdır).
    """
    ders = await ip1a.odenmis()
    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(days=40))
    _aid, admin_auth = await ip1a.admin(izinler=["bookings.view", "bookings.manage"])

    async def auto_complete():
        async with AsyncSessionLocal() as s:
            await booking_service.auto_complete_past_bookings(s)
            await s.commit()

    async def ihtilaf_ac():
        await ip1a_http.post(
            f"/api/v1/admin/bookings/{ders.booking_id}/dispute",
            json={"is_disputed": True, "admin_notes": "İP-1a yarış"},
            headers=admin_auth,
        )

    await asyncio.gather(auto_complete(), ihtilaf_ac())

    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, ders.booking_id)
        ihtilafli = booking.is_disputed
        booking_status = booking.status
    p = await ip1a.payment(ders.booking_id)

    assert not (ihtilafli and p["released_at"] is not None), (
        "İHTİLAFLI DERSİN PARASI SERBEST BIRAKILDI: is_disputed=True ve "
        "released_at dolu. İade kalıcı olarak kapandı, admin çözüm üretemez."
    )
    izinli = {
        (BookingStatus.ACCEPTED, PaymentStatus.HELD),
        (BookingStatus.COMPLETED, PaymentStatus.RELEASED),
    }
    assert (booking_status, PaymentStatus(p["status"])) in izinli
    assert provider.refund_calls == []


# ═══════════════════════ YEŞİL NÖBETÇİLER ════════════════════════════════════


async def test_YESIL_iki_esZamanli_tamamlama_TEK_release_uretir(ip1a, provider, ip1a_http):
    """`complete`'in **atomik claim'i** çalışıyor: bayat okumayla yazan kaybeder.

    ## Bu test bir kez zayıftı — neden ve nasıl güçlendirildi

    İlk hâli iki `complete` görevini `asyncio.gather` ile başlatıyordu. O kurulum
    yarış KURMUYORDU: ikinci görev booking satırını ilk görev **commit ettikten
    sonra** okuyordu, dolayısıyla 409'u bellekteki `_transition` üretiyordu ve
    `_claim_transition`'ın koşullu UPDATE'i hiç sınanmıyordu. Kanıt: claim
    çağrısı bellek içi `_transition` + `flush()` ile değiştirildiğinde test yine
    yeşil kalıyordu (bağımsız denetim, P1-1).

    Güçlendirilmiş kurulum gerçek üretim interleaving'ini modeller:

        kaybeden: SELECT (ACCEPTED okur) ──────────────┐  (kapıda bekler)
        kazanan:            SELECT → UPDATE → COMMIT ──┘
        kaybeden: ── bayat ACCEPTED ile YAZMAYA DEVAM EDER

    Bellek içi FSM bu durumda kaybedeni geçirir (elindeki nesne hâlâ ACCEPTED);
    yalnız `WHERE status IN (ACCEPTED)` koşullu UPDATE'i onu durdurabilir. Yani
    testin ölçtüğü şey artık gerçekten **atomikliktir**.

    ## Ölçülenler

    Tek final durum · tek `released_at` damgası · tek hakediş · kaybedende
    **hiçbir yan etki** (bildirim dahil) · kaybedene güvenli 409.
    """
    ders = await ip1a.odenmis()
    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(days=40))
    bildirim_once = await ip1a.bildirim_sayisi(user_id=ders.client_id, role_id=3)

    okundu, kazanan_bitti = asyncio.Event(), asyncio.Event()

    async def kaybeden() -> bool:
        """ACCEPTED'ı okur, kazananın commit'ini bekler, sonra yazmayı dener."""
        async with AsyncSessionLocal() as s:
            await s.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
            booking = await s.get(Booking, ders.booking_id)
            assert booking.status is BookingStatus.ACCEPTED, (
                "kurulum: kaybeden taraf ACCEPTED okumalıydı"
            )
            okundu.set()
            await kazanan_bitti.wait()
            try:
                await booking_service.complete(s, booking)
                await s.commit()
                return True
            except HTTPException as exc:
                if exc.status_code == 409:
                    return False
                raise

    gorev = asyncio.create_task(kaybeden())
    await okundu.wait()  # bayat okuma GERÇEKTEN yapıldı

    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, ders.booking_id)
        await booking_service.complete(s, booking)
        await s.commit()

    kazanan_damga = (await ip1a.payment(ders.booking_id))["released_at"]
    assert kazanan_damga is not None, "kurulum: kazanan taraf release üretmedi"

    kazanan_bitti.set()
    kaybeden_yazabildi = await gorev

    assert not kaybeden_yazabildi, (
        "KAYIP GÜNCELLEME: bayat ACCEPTED okumasıyla gelen ikinci tamamlama "
        "başarıyla yazdı. `complete` atomik claim yerine bellek içi FSM'e "
        "dayanıyor olmalı — commit'lenmiş terminal durumun üzerine yazılabilir."
    )

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert (booking_status, payment_status) == (
        BookingStatus.COMPLETED,
        PaymentStatus.RELEASED,
    )
    p = await ip1a.payment(ders.booking_id)
    assert p["released_at"] == kazanan_damga, (
        "ikinci tamamlama `released_at` damgasını yeniden yazdı — hakediş anı kaydı bozuldu"
    )
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal(str(p["tutor_earning"])), (
        "kazanç iki kez sayıldı"
    )
    assert await ip1a.bildirim_sayisi(user_id=ders.client_id, role_id=3) == bildirim_once + 1, (
        "kaybeden taraf da 'dersin tamamlandı' bildirimi yazdı — 409 alması "
        "gerekirken akışın gövdesini koşturmuş"
    )


async def test_YESIL_iki_esZamanli_iptal_TEK_IADE_uretir(ip1a, provider, ip1a_http):
    """`cancel` claim'i + escrow claim'i birlikte: çift iade imkânsız.

    Yarış penceresi sağlayıcı kapısıyla (`StubProvider.refund_gate`) açılır: iki
    transaction da "HELD okundu, henüz yazılmadı" anında buluşur.

    Ardışıklık `sleep(0.5)` ile TAHMİN EDİLMEZ: her iki görev de satırı okuduğunu
    kendi `okundu` event'iyle bildirir, ikisi de okuduktan sonra `baslat` açılır,
    kazananın sağlayıcı kapısına vardığı da `refund_entered` ile beklenir.
    """
    ders = await ip1a.odenmis()
    provider.refund_gate = asyncio.Event()
    okundu = (asyncio.Event(), asyncio.Event())
    baslat = asyncio.Event()

    async def iptal_et(i: int):
        async with AsyncSessionLocal() as s:
            await s.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
            booking = await s.get(Booking, ders.booking_id)
            okundu[i].set()
            await baslat.wait()
            try:
                await booking_service.cancel(
                    s, booking, cancelled_by=await _client_of(s, ders)
                )
                await s.commit()
            except HTTPException as exc:
                if exc.status_code != 409:
                    raise

    t1 = asyncio.create_task(iptal_et(0))
    t2 = asyncio.create_task(iptal_et(1))
    await asyncio.gather(*(e.wait() for e in okundu))  # ikisi de ACCEPTED+HELD okudu
    baslat.set()
    await provider.refund_entered.wait()  # kazanan faz-1'i commit'ledi, kapıda
    provider.refund_gate.set()
    await asyncio.gather(t1, t2)

    assert len(provider.refund_calls) == 1, (
        f"ÇİFT İADE: sağlayıcıya {len(provider.refund_calls)} emir gitti"
    )
    _bs, payment_status = await ip1a.durumlar(ders.booking_id)
    assert payment_status in COZULMUS


async def test_YESIL_tamamlama_ile_iptal_yarisinda_IKISI_BIRDEN_olmaz(
    ip1a, provider, ip1a_http
):
    """release ↔ refund: `released_at` ve `refunded_at` aynı satırda dolamaz.

    Ders katmanındaki karşılığı; escrow katmanındaki eşdeğeri
    `test_money_pg.py::test_c1_release_refund_race` ile korunuyor.

    Kurulum `sleep(0.3)` yerine iki olayla kurulur ve bu sayede **bayat okuma**
    yarışı olur: tamamlama tarafı satırı iptalden ÖNCE okur (`okundu`), iptal
    faz-1'ini commit'leyip sağlayıcıda asılır (`refund_entered`), ancak ondan
    sonra tamamlama elindeki bayat ACCEPTED ile yazmayı dener.
    """
    ders = await ip1a.odenmis()
    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(days=40))
    provider.refund_gate = asyncio.Event()
    okundu, iptal_kapida = asyncio.Event(), asyncio.Event()

    async def tamamla():
        async with AsyncSessionLocal() as s:
            await s.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
            booking = await s.get(Booking, ders.booking_id)
            okundu.set()
            await iptal_kapida.wait()
            try:
                await booking_service.complete(s, booking)
                await s.commit()
            except HTTPException as exc:
                if exc.status_code != 409:
                    raise

    tamamla_gorevi = asyncio.create_task(tamamla())
    await okundu.wait()

    async def iptal_et():
        async with AsyncSessionLocal() as s:
            booking = await s.get(Booking, ders.booking_id)
            try:
                await booking_service.cancel(
                    s, booking, cancelled_by=await _client_of(s, ders)
                )
                await s.commit()
            except HTTPException as exc:
                if exc.status_code != 409:
                    raise

    iptal_gorevi = asyncio.create_task(iptal_et())
    await provider.refund_entered.wait()  # iptal faz-1 commit'lendi, sağlayıcıda asılı

    iptal_kapida.set()
    await tamamla_gorevi

    provider.refund_gate.set()
    await iptal_gorevi

    p = await ip1a.payment(ders.booking_id)
    assert not (p["released_at"] is not None and p["refunded_at"] is not None), (
        "hem eğitmene kazanç yazıldı hem öğrenciye iade edildi"
    )
    assert len(provider.refund_calls) <= 1
