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

Yarış, `asyncio.sleep` serpiştirerek değil, **açık bir kapıyla** kurulur:
kaybetmesi gereken taraf satırı okur, kapıda bekler, kazanan taraf tam
transaction'ını commit eder, sonra kaybeden yazmaya devam eder. Bu, gerçek
üretim interleaving'inin (oku → başkası commit'ledi → yaz) birebir modelidir ve
her koşuda **aynı** sonucu verir.

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


async def _gecikmeli_okuyucu(booking_id: int, kapi: asyncio.Event, eylem):
    """Satırı okur, kapıyı bekler, sonra eylemi uygular — kaybeden taraf.

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
    kapi = asyncio.Event()

    async def gec_accept(s, booking):
        await booking_service.accept(s, booking)

    accept_gorevi = asyncio.create_task(
        _gecikmeli_okuyucu(ders.booking_id, kapi, gec_accept)
    )
    await asyncio.sleep(0.2)  # accept satırı okusun ve kapıda beklesin

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
    kapi = asyncio.Event()

    async def gec_reject(s, booking):
        await booking_service.reject(s, booking)

    reject_gorevi = asyncio.create_task(
        _gecikmeli_okuyucu(ders.booking_id, kapi, gec_reject)
    )
    await asyncio.sleep(0.2)

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
    kapi = asyncio.Event()

    async def gec_admin_iptal(s, booking):
        await admin_service.cancel_booking(s, booking, reason="İP-1a yarış")

    admin_gorevi = asyncio.create_task(
        _gecikmeli_okuyucu(ders.booking_id, kapi, gec_admin_iptal)
    )
    await asyncio.sleep(0.2)

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
    """`complete` claim'i çalışıyor: iki eşzamanlı istekten biri 409 alır.

    Bu, ölçüm aracının kanıtıdır: aynı kurulumla "tek kazanan" davranışını
    gösterebiliyoruz, dolayısıyla accept/reject'teki kırmızılık testin
    yetersizliğinden değil kodun eksikliğinden geliyor.
    """
    ders = await ip1a.odenmis()
    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(days=40))

    async def tamamla(etiket: str):
        async with AsyncSessionLocal() as s:
            booking = await s.get(Booking, ders.booking_id)
            try:
                await booking_service.complete(s, booking)
                await s.commit()
                return etiket
            except HTTPException as exc:
                if exc.status_code == 409:
                    return None
                raise

    sonuclar = await asyncio.gather(tamamla("a"), tamamla("b"))
    kazananlar = [x for x in sonuclar if x is not None]
    assert len(kazananlar) == 1, f"tam olarak biri kazanmalıydı: {sonuclar}"

    _bs, payment_status = await ip1a.durumlar(ders.booking_id)
    assert payment_status is PaymentStatus.RELEASED
    p = await ip1a.payment(ders.booking_id)
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal(str(p["tutor_earning"])), (
        "kazanç iki kez sayıldı"
    )


async def test_YESIL_iki_esZamanli_iptal_TEK_IADE_uretir(ip1a, provider, ip1a_http):
    """`cancel` claim'i + escrow claim'i birlikte: çift iade imkânsız.

    Yarış penceresi sağlayıcı kapısıyla (`StubProvider.refund_gate`) açılır: iki
    transaction da "HELD okundu, henüz yazılmadı" anında buluşur.
    """
    ders = await ip1a.odenmis()
    provider.refund_gate = asyncio.Event()

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

    t1 = asyncio.create_task(iptal_et())
    t2 = asyncio.create_task(iptal_et())
    await asyncio.sleep(0.5)
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
    """
    ders = await ip1a.odenmis()
    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(days=40))
    provider.refund_gate = asyncio.Event()

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
    await asyncio.sleep(0.3)  # iptal sağlayıcıda beklesin

    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, ders.booking_id)
        try:
            await booking_service.complete(s, booking)
            await s.commit()
        except HTTPException as exc:
            if exc.status_code != 409:
                raise

    provider.refund_gate.set()
    await iptal_gorevi

    p = await ip1a.payment(ders.booking_id)
    assert not (p["released_at"] is not None and p["refunded_at"] is not None), (
        "hem eğitmene kazanç yazıldı hem öğrenciye iade edildi"
    )
    assert len(provider.refund_calls) <= 1
