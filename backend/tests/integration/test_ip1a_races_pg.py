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
2. Test `_event_bekle(okundu, ...)` ile o okumanın GERÇEKTEN yapıldığını bilir.
3. Kazanan taraf tam transaction'ını çalıştırıp commit eder.
4. Test kapıyı açar; kaybeden **bayat okumasıyla** yazmaya devam eder.

Bu, gerçek üretim interleaving'inin (oku → başkası commit'ledi → yaz) birebir
modelidir ve her koşuda aynı sonucu verir. `sleep(0.2)` ile kurulan sıra ise iki
yönden hatalıydı: yüklü makinede yetmeyip yarışı hiç kurmayabilir (**yalancı
yeşil**), boş makinede ise gereksiz yere bekletir.

Sağlayıcıda asılı kalan tarafın "oraya vardığı" da tahmin edilmez:
`StubProvider.refund_entered` (`conftest.py`) iade kapısına girildiği anda set
edilir ve testler onu bekler.

## Kapılar SÜRELİDİR — sonuçlanmayan test kırmızıdır (P1-3)

Çıplak `await <event>.wait()` bu dosyada **yasaktır**; her bekleme
`_event_bekle`/`_gorev_bekle` üzerinden `KAPI_TIMEOUT` ile sınırlıdır. Sebep
ölçüldü: A1 mutasyonunda (`cancel` içindeki `payment_service.refund` no-op)
kapıyı açacak kimse kalmıyor ve sleep'siz kurulum testi kırmızıya değil
**sonsuz beklemeye** çeviriyordu — `pytest.ini`'de global timeout olmadığı için
koşu ancak CI'nın üst sınırında ölürdü. "Koşmayan test kırmızıdır" kuralının
kardeşi budur: **sonuçlanmayan test de kırmızıdır**, üstelik sessizdir. Aynı
yapı üretici görevin `Event.set()` öncesinde düşmesini de gizlemez: asıl hata
"kapı açılmadı" gürültüsünün yerine geçer. Görevler `yaris` fixture'ında
kayıtlıdır; test nasıl biterse bitsin pending görev kalmaz.

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
from collections.abc import Coroutine, Iterable, Sequence
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.booking import Booking, BookingStatus
from models.client import Client
from models.payment import PaymentStatus
from services import admin_service, booking_service

COZULMUS = (PaymentStatus.REFUNDING, PaymentStatus.REFUNDED)
LOCK_TIMEOUT = "5s"

#: Bir kapının açılması / bir yarış görevinin bitmesi için beklenecek EN ÇOK
#: süre. Dosyada **tek** bir sabit vardır; gerekçesi üç maddedir:
#:
#: 1. `LOCK_TIMEOUT` 5 sn'dir. Kilit sırası hatası kendi teşhis edilebilir
#:    hatasını üretebilsin diye bu tavan onun iki katından büyük olmalıdır;
#:    aksi halde her kilit beklemesi "kapı açılmadı" diye YANLIŞ adlandırılırdı.
#: 2. Soğuk bir CI Postgres'inde ilk bağlantı + migration sonrası ilk sorgu
#:    birkaç saniye sürebilir; 12 sn bunu yanlış pozitife çevirmeyecek kadar
#:    geniştir.
#: 3. Buna karşılık gerçek bir asılma (ör. hiç çağrılmayan `refund`) en geç
#:    ~12 sn'de kırmızıya döner — pytest'i dışarıdan öldürmeye gerek kalmaz.
#:
#: Üretici görevlerin hepsi bittiği hâlde kapı açılmamışsa süre BEKLENMEZ:
#: kapıyı açabilecek kimse kalmadığı için hata anında verilir (A1 mutasyonu
#: böylece saniyenin altında kırmızıya düşer).
KAPI_TIMEOUT = 12.0


async def _client_of(s, ders) -> Client:
    return await s.get(Client, ders.client_id)


# ═══════════════════════ SONLU KAPILAR (bounded barrier) ═════════════════════


def _gorev_adi() -> str:
    gorev = asyncio.current_task()
    return gorev.get_name() if gorev is not None else "?"


async def _gorevleri_kapat(gorevler: Iterable[asyncio.Task]) -> None:
    """Başlatılmış yarış görevlerini iptal eder ve **toplar** — pending bırakmaz.

    Bitmiş görevlerin sonucu da okunur: hata ile biten bir görevin
    `exception()`'ı hiç çağrılmazsa asyncio çöp toplamada "Task exception was
    never retrieved" uyarısı basar. O uyarı testin kendi hata mesajının altında
    kaybolur ve gerçek sebebi gizler.
    """
    hepsi = [g for g in gorevler if g is not None]
    canli = [g for g in hepsi if not g.done()]
    for g in canli:
        g.cancel()
    if canli:
        await asyncio.gather(*canli, return_exceptions=True)
    for g in hepsi:
        if g.done() and not g.cancelled():
            g.exception()


async def _event_bekle(
    event: asyncio.Event,
    *,
    aciklama: str,
    ureticiler: Sequence[asyncio.Task] = (),
    timeout: float = KAPI_TIMEOUT,
) -> None:
    """Bir kapının açılmasını **süreli** bekler (P1-3).

    Üç sonlanma yolu vardır ve üçü de sonludur:

    1. Kapı açıldı → sessizce döner.
    2. Kapıyı açması gereken üretici görev **hata ile düştü** ya da kapıyı hiç
       açmadan bitti → o hata `aciklama` ile birlikte yükseltilir. Sonsuz
       beklemeye dönüşmez ve asıl exception gizlenmez.
    3. Süre doldu → hangi kapının açılmadığını söyleyen açıklayıcı FAILED.

    2 ve 3'te `ureticiler` iptal edilip toplanır; `TimeoutError` yutulup akışa
    devam EDİLMEZ — yutulan bir timeout, yarışı hiç kurmamış bir testi yeşil
    gösterirdi.
    """
    izlenen = [g for g in ureticiler if g is not None]
    bekleyen = list(izlenen)
    kapi = asyncio.ensure_future(event.wait())
    dongu = asyncio.get_running_loop()
    bitis = dongu.time() + timeout
    sessiz_bitenler: list[str] = []
    try:
        while not event.is_set():
            if izlenen and not bekleyen:
                # Kapıyı açabilecek kimse kalmadı; süreyi doldurmanın anlamı yok.
                await _gorevleri_kapat(izlenen)
                pytest.fail(
                    f"KAPI AÇILMADI — {aciklama}. Üretici görevlerin hepsi "
                    f"({', '.join(sessiz_bitenler)}) kapıyı hiç açmadan bitti.",
                    pytrace=False,
                )
            kalan = bitis - dongu.time()
            if kalan <= 0:
                await _gorevleri_kapat(izlenen)
                pytest.fail(
                    f"{timeout:.0f} sn içinde KAPI AÇILMADI — {aciklama}.",
                    pytrace=False,
                )
            await asyncio.wait(
                {kapi, *bekleyen}, timeout=kalan, return_when=asyncio.FIRST_COMPLETED
            )
            for gorev in [g for g in bekleyen if g.done()]:
                bekleyen.remove(gorev)
                if event.is_set():
                    continue
                hata = None if gorev.cancelled() else gorev.exception()
                if hata is not None or gorev.cancelled():
                    await _gorevleri_kapat(izlenen)
                    raise AssertionError(
                        f"KAPI AÇILMADI çünkü üretici görev '{gorev.get_name()}' "
                        f"daha önce düştü — {aciklama}"
                    ) from hata
                sessiz_bitenler.append(gorev.get_name())
    finally:
        kapi.cancel()


async def _gorev_bekle(gorev: asyncio.Task, *, aciklama: str, timeout: float = KAPI_TIMEOUT):
    """Bir yarış görevinin bitmesini süreli bekler.

    `asyncio.wait_for` timeout'ta görevi iptal edip TOPLAR; pending görev kalmaz.
    Görevin kendi exception'ı olduğu gibi yükselir (yutulmaz).
    """
    try:
        return await asyncio.wait_for(gorev, timeout)
    except TimeoutError:
        pytest.fail(
            f"{timeout:.0f} sn içinde yarış görevi bitmedi — {aciklama}",
            pytrace=False,
        )


async def _gorevleri_bekle(
    gorevler: Sequence[asyncio.Task], *, aciklama: str, timeout: float = KAPI_TIMEOUT
):
    """`_gorev_bekle`'nin çoklu hâli — hepsinin bitmesini süreli bekler."""
    try:
        return await asyncio.wait_for(asyncio.gather(*gorevler), timeout)
    except TimeoutError:
        await _gorevleri_kapat(gorevler)
        pytest.fail(
            f"{timeout:.0f} sn içinde yarış görevleri bitmedi — {aciklama}",
            pytrace=False,
        )


@pytest.fixture
async def yaris():
    """Yarış görevlerini kaydeder; test NASIL biterse bitsin pending bırakmaz.

    Görevleri elle `asyncio.create_task` ile başlatmak, testin ortasında düşen
    bir assert'te görevi askıda bırakır: hem "Task was destroyed but it is
    pending!" uyarısı çıkar hem de o görev bir DB bağlantısını tutmaya devam
    eder. Fixture teardown'ı kırmızı testte de koştuğu için temizlik garantidir.

    Test imzasında **en sonda** durur: pytest fixture'ları kurulumun tersi
    sırayla söker, yani görevler `ip1a` temizliğinden ve `engine.dispose()`'dan
    ÖNCE iptal edilir.
    """
    kayit: list[asyncio.Task] = []

    def baslat(coro: Coroutine, *, ad: str) -> asyncio.Task:
        gorev = asyncio.create_task(coro, name=ad)
        kayit.append(gorev)
        return gorev

    yield baslat
    await _gorevleri_kapat(kayit)


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
    asılmak yerine hızlı ve teşhis edilebilir biçimde düşer. Aynı gerekçe kapı
    beklemesi için de geçerlidir: testin kapıyı hiç açmadığı hâl (ör. ana test
    daha önce düştü) burada da SÜRELİDİR.
    """
    async with AsyncSessionLocal() as s:
        await s.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
        booking = await s.get(Booking, booking_id)
        assert booking.status is BookingStatus.PENDING or booking.status is BookingStatus.ACCEPTED
        okundu.set()
        await _event_bekle(
            kapi, aciklama=f"test '{_gorev_adi()}' görevinin kapısını hiç açmadı"
        )
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
    ip1a, provider, ip1a_http, yaris
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

    accept_gorevi = yaris(
        _gecikmeli_okuyucu(ders.booking_id, okundu=okundu, kapi=kapi, eylem=gec_accept),
        ad="accept",
    )
    # accept satırı GERÇEKTEN okudu ve kapıda bekliyor
    await _event_bekle(
        okundu,
        aciklama="accept tarafı (kaybeden) booking satırını hiç okumadı",
        ureticiler=(accept_gorevi,),
    )

    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, ders.booking_id)
        await booking_service.cancel(s, booking, cancelled_by=await _client_of(s, ders))
        await s.commit()

    kapi.set()
    accept_basarili = await _gorev_bekle(
        accept_gorevi, aciklama="kapı açıldıktan sonra accept görevi bitmedi"
    )

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


async def test_reject_ile_ogrenci_iptali_yarisinda_TEK_KAZANAN_olur(
    ip1a, provider, ip1a_http, yaris
):
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

    reject_gorevi = yaris(
        _gecikmeli_okuyucu(ders.booking_id, okundu=okundu, kapi=kapi, eylem=gec_reject),
        ad="reject",
    )
    await _event_bekle(
        okundu,
        aciklama="reject tarafı (kaybeden) booking satırını hiç okumadı",
        ureticiler=(reject_gorevi,),
    )

    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, ders.booking_id)
        await booking_service.cancel(s, booking, cancelled_by=await _client_of(s, ders))
        await s.commit()

    kapi.set()
    reject_basarili = await _gorev_bekle(
        reject_gorevi, aciklama="kapı açıldıktan sonra reject görevi bitmedi"
    )

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


async def test_admin_iptali_ile_tutor_tamamlamasi_yarisinda_TEK_SONUC(
    ip1a, provider, ip1a_http, yaris
):
    """admin cancel ↔ tutor complete: hem iade hem hakediş birlikte olamaz.

    Admin yolu read-modify-write olduğu için (`admin_service.py:397-404`) status
    ile para durumu ayrışabilir: tamamlanmış satıra admin `CANCELLED` yazabilir.
    Modül 2 (17 Eyl 2026): `complete` artık parayı serbest bırakmaz (öğrenci
    onayı/72 sa pencere bekler), bu yüzden tamamlama kazanırsa beklenen sonuç
    `COMPLETED + HELD`'dir; invariant aynıdır — ders durumu ile para ayrışmaz.
    """
    ders = await ip1a.odenmis()
    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(days=40))
    okundu, kapi = asyncio.Event(), asyncio.Event()

    async def gec_admin_iptal(s, booking):
        await admin_service.cancel_booking(s, booking, reason="İP-1a yarış")

    admin_gorevi = yaris(
        _gecikmeli_okuyucu(
            ders.booking_id, okundu=okundu, kapi=kapi, eylem=gec_admin_iptal
        ),
        ad="admin-iptal",
    )
    await _event_bekle(
        okundu,
        aciklama="admin iptali (kaybeden) booking satırını hiç okumadı",
        ureticiler=(admin_gorevi,),
    )

    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, ders.booking_id)
        await booking_service.complete(s, booking)
        await s.commit()

    kapi.set()
    await _gorev_bekle(
        admin_gorevi, aciklama="kapı açıldıktan sonra admin iptali görevi bitmedi"
    )

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    p = await ip1a.payment(ders.booking_id)

    assert not (p["released_at"] is not None and p["refunded_at"] is not None), (
        "hem release hem refund gerçekleşti: eğitmen kazancı + öğrenci iadesi"
    )
    izinli = {
        (BookingStatus.COMPLETED, PaymentStatus.HELD),
        (BookingStatus.CANCELLED, PaymentStatus.REFUNDING),
        (BookingStatus.CANCELLED, PaymentStatus.REFUNDED),
    }
    assert (booking_status, payment_status) in izinli, (
        f"TUTARSIZ SONUÇ: booking={booking_status.value}, ödeme={payment_status}. "
        "Admin iptali claim kullanmadığı için ders durumu ile para durumu ayrıştı."
    )
    assert p["released_at"] is None, "eğitmen tamamlaması parayı serbest bıraktı (Modül 2)"
    assert len(provider.refund_calls) <= 1


async def test_ihtilaf_acilmasi_ile_auto_complete_yarisinda_PARA_ACILMAZ(
    ip1a, provider, ip1a_http, yaris
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

    await _gorevleri_bekle(
        [yaris(auto_complete(), ad="auto-complete"), yaris(ihtilaf_ac(), ad="dispute")],
        aciklama="auto-complete ↔ dispute görevleri bitmedi",
    )

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


async def test_YESIL_iki_esZamanli_tamamlama_TEK_gecis_uretir(
    ip1a, provider, ip1a_http, yaris
):
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

    Tek final durum · kaybedende **hiçbir yan etki** (bildirim dahil) ·
    kaybedene güvenli 409. Modül 2 (17 Eyl 2026): `complete` parayı serbest
    bırakmaz; para HELD kalır. Ardından öğrencinin onayı TEK release üretir —
    tek hakediş hâlâ ölçülür (ikinci onay yeni hareket üretmez).
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
            await _event_bekle(
                kazanan_bitti,
                aciklama="kazanan taraf commit'ini bitiremedi (kapı hiç açılmadı)",
            )
            try:
                await booking_service.complete(s, booking)
                await s.commit()
                return True
            except HTTPException as exc:
                if exc.status_code == 409:
                    return False
                raise

    gorev = yaris(kaybeden(), ad="kaybeden-tamamlama")
    # bayat okuma GERÇEKTEN yapıldı
    await _event_bekle(
        okundu,
        aciklama="kaybeden taraf ACCEPTED booking satırını hiç okumadı",
        ureticiler=(gorev,),
    )

    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, ders.booking_id)
        await booking_service.complete(s, booking)
        await s.commit()

    assert (await ip1a.payment(ders.booking_id))["released_at"] is None, (
        "eğitmen tamamlaması parayı öğrenci onayı beklemeden serbest bıraktı"
    )

    kazanan_bitti.set()
    kaybeden_yazabildi = await _gorev_bekle(
        gorev, aciklama="kapı açıldıktan sonra kaybeden tamamlama görevi bitmedi"
    )

    assert not kaybeden_yazabildi, (
        "KAYIP GÜNCELLEME: bayat ACCEPTED okumasıyla gelen ikinci tamamlama "
        "başarıyla yazdı. `complete` atomik claim yerine bellek içi FSM'e "
        "dayanıyor olmalı — commit'lenmiş terminal durumun üzerine yazılabilir."
    )

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert (booking_status, payment_status) == (
        BookingStatus.COMPLETED,
        PaymentStatus.HELD,
    )
    assert (await ip1a.payment(ders.booking_id))["released_at"] is None, (
        "kaybeden tamamlama parayı serbest bıraktı"
    )
    assert await ip1a.bildirim_sayisi(user_id=ders.client_id, role_id=3) == bildirim_once + 1, (
        "kaybeden taraf da 'dersin tamamlandı' bildirimi yazdı — 409 alması "
        "gerekirken akışın gövdesini koşturmuş"
    )

    # Para öğrenci onayıyla eğitmene geçer; ikinci onay yeni hareket üretmez.
    damgalar = []
    for _ in range(2):
        async with AsyncSessionLocal() as s:
            booking = await s.get(Booking, ders.booking_id)
            await booking_service.confirm_by_student(s, booking)
            await s.commit()
        damgalar.append((await ip1a.payment(ders.booking_id))["released_at"])
    assert damgalar[0] is not None and damgalar[0] == damgalar[1], (
        "ikinci onay `released_at` damgasını yeniden yazdı — hakediş anı kaydı bozuldu"
    )
    p = await ip1a.payment(ders.booking_id)
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal(str(p["tutor_earning"])), (
        "kazanç iki kez sayıldı"
    )


async def test_YESIL_iki_esZamanli_iptal_TEK_IADE_uretir(ip1a, provider, ip1a_http, yaris):
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
            await _event_bekle(
                baslat,
                aciklama=f"test '{_gorev_adi()}' görevinin başlat kapısını hiç açmadı",
            )
            try:
                await booking_service.cancel(
                    s, booking, cancelled_by=await _client_of(s, ders)
                )
                await s.commit()
            except HTTPException as exc:
                if exc.status_code != 409:
                    raise

    t1 = yaris(iptal_et(0), ad="iptal-0")
    t2 = yaris(iptal_et(1), ad="iptal-1")
    for i, e in enumerate(okundu):  # ikisi de ACCEPTED+HELD okudu
        await _event_bekle(
            e,
            aciklama=(
                f"{i}. iptal işçisi booking satırını hiç okumadı — iki worker'ın "
                "okuma kapıları tamamlanmadı, yarış hiç kurulmadı"
            ),
            ureticiler=(t1, t2),
        )
    baslat.set()
    # kazanan faz-1'i commit'ledi ve sağlayıcı kapısında
    await _event_bekle(
        provider.refund_entered,
        aciklama=(
            "refund sağlayıcı kapısına hiç ulaşılmadı: iptal yolu iade emri "
            "üretmiyor (emanetteki para sahipsiz kalır)"
        ),
        ureticiler=(t1, t2),
    )
    provider.refund_gate.set()
    await _gorevleri_bekle([t1, t2], aciklama="iptal görevleri bitmedi")

    assert len(provider.refund_calls) == 1, (
        f"ÇİFT İADE: sağlayıcıya {len(provider.refund_calls)} emir gitti"
    )
    _bs, payment_status = await ip1a.durumlar(ders.booking_id)
    assert payment_status in COZULMUS


async def test_YESIL_onay_ile_iptal_yarisinda_IKISI_BIRDEN_olmaz(
    ip1a, provider, ip1a_http, yaris
):
    """release ↔ refund: `released_at` ve `refunded_at` aynı satırda dolamaz.

    Ders katmanındaki karşılığı; escrow katmanındaki eşdeğeri
    `test_money_pg.py::test_c1_release_refund_race` ile korunuyor.

    Modül 2 (17 Eyl 2026): parayı serbest bırakan kullanıcı yolu artık eğitmenin
    `complete`'i değil, öğrencinin onayıdır (`confirm_by_student`). Başlamış ders
    öğrenci/eğitmen tarafından iptal edilemediği için iade tarafı admin
    iptalidir (`cancel_by_admin`) — başlamış derste iade üretebilen kullanıcı
    dışı yol.

    Kurulum `sleep(0.3)` yerine iki olayla kurulur ve bu sayede **bayat okuma**
    yarışı olur: onay tarafı satırı iptalden ÖNCE okur (`okundu`), iptal
    faz-1'ini commit'leyip sağlayıcıda asılır (`refund_entered`), ancak ondan
    sonra onay elindeki bayat ACCEPTED ile yazmayı dener.
    """
    ders = await ip1a.odenmis()
    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(days=40))
    provider.refund_gate = asyncio.Event()
    okundu, iptal_kapida = asyncio.Event(), asyncio.Event()

    async def onayla():
        async with AsyncSessionLocal() as s:
            await s.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
            booking = await s.get(Booking, ders.booking_id)
            okundu.set()
            await _event_bekle(
                iptal_kapida,
                aciklama=(
                    "iptal tarafı sağlayıcı kapısına varmadı, onay kapısı "
                    "hiç açılmadı"
                ),
            )
            try:
                await booking_service.confirm_by_student(s, booking)
                await s.commit()
            except HTTPException as exc:
                if exc.status_code != 409:
                    raise

    onay_gorevi = yaris(onayla(), ad="onay")
    await _event_bekle(
        okundu,
        aciklama="onay tarafı booking satırını hiç okumadı (bayat okuma kurulmadı)",
        ureticiler=(onay_gorevi,),
    )

    async def iptal_et():
        async with AsyncSessionLocal() as s:
            booking = await s.get(Booking, ders.booking_id)
            try:
                await admin_service.cancel_booking(s, booking, reason="İP-1a yarış")
                await s.commit()
            except HTTPException as exc:
                if exc.status_code != 409:
                    raise

    iptal_gorevi = yaris(iptal_et(), ad="iptal")
    # iptal faz-1 commit'lendi ve sağlayıcıda asılı
    await _event_bekle(
        provider.refund_entered,
        aciklama=(
            "refund sağlayıcı kapısına hiç ulaşılmadı: iptal yolu iade emri "
            "üretmiyor, dolayısıyla release ↔ refund yarışı hiç kurulmadı"
        ),
        ureticiler=(iptal_gorevi,),
    )

    iptal_kapida.set()
    await _gorev_bekle(onay_gorevi, aciklama="onay görevi bitmedi")

    provider.refund_gate.set()
    await _gorev_bekle(iptal_gorevi, aciklama="iptal görevi bitmedi")

    p = await ip1a.payment(ders.booking_id)
    assert not (p["released_at"] is not None and p["refunded_at"] is not None), (
        "hem eğitmene kazanç yazıldı hem öğrenciye iade edildi"
    )
    assert p["released_at"] is None, (
        "iptal edilmiş dersin parası bayat onayla eğitmene geçti"
    )
    assert len(provider.refund_calls) <= 1


# ═══════ RESCHEDULE ↔ COMPLETE (nihai audit P1-B) ════════════════════════════
#
# `reschedule` durumu eskiden `booking.status = BookingStatus.PENDING` biçiminde
# **koşulsuz ORM ataması** ile yazıyordu; FSM'i de atomik claim'i de atlıyordu.
# Bağımsız nihai audit gerçek PostgreSQL'de şu final durumu üretti:
#
#     booking.status = PENDING · payment.status = RELEASED · released_at dolu
#
# Yani ders "tamamlanmamış" görünürken para eğitmene dağıtılmıştı ve iade yolu
# `released_at` guard'ı yüzünden KALICI olarak kapanmıştı. Aşağıdaki iki test
# yarışın **her iki yönünü** de deterministik olarak ölçer: kazanan hangisi
# olursa olsun, ikisi birden başarılı olamaz.
#
# Modül 2 (17 Eyl 2026): iki kural bu yarışı üst katmanda zaten keser —
# `complete` başlamamış derse, `reschedule` ise derse 12 saatten az kalmış
# (başlamış dahil) derse 409 verir; ayrıca `complete` parayı serbest bırakmaz.
# Testler claim'in KENDİSİNİ ölçmeye devam etsin diye 12 saat kuralı burada
# `_gec_kurali_kapat` ile devre dışı bırakılır (savunmanın ikinci hattı).


@pytest.fixture
def _gec_kurali_kapat(monkeypatch):
    """Geçmişteki dersi de "geç" saymayacak kadar küçük eşik: yalnız claim sınanır."""
    from core.config import settings

    monkeypatch.setattr(settings, "LESSON_LATE_CANCEL_HOURS", -24 * 365)


async def _ders_zamani(booking_id: int):
    """Dersin (start_at, end_at) değerlerini TAZE session'dan okur."""
    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, booking_id)
        return booking.start_at, booking.end_at


def _yeni_saat(*, gun: int = 40, saat: int = 1):
    start = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=gun)
    return start, start + datetime.timedelta(hours=saat)


async def test_reschedule_KAZANIRSA_tamamlama_PARAYI_ACAMAZ(
    ip1a, provider, ip1a_http, _gec_kurali_kapat, yaris
):
    """Sıralama A: reschedule commit'lendikten sonra gelen `complete` kaybeder.

    Kaybeden taraf bayat `ACCEPTED` okumasıyla gelir; onu yalnız `complete`'in
    koşullu UPDATE'i durdurabilir. Durduramazsa ders PENDING'ken parası
    RELEASED olur — "yeniden onay bekleyen ders + dağıtılmış para".
    """
    ders = await ip1a.odenmis()
    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(days=40))
    okundu, kapi = asyncio.Event(), asyncio.Event()

    async def gec_tamamla(s, booking):
        await booking_service.complete(s, booking)

    tamamla_gorevi = yaris(
        _gecikmeli_okuyucu(
            ders.booking_id, okundu=okundu, kapi=kapi, eylem=gec_tamamla
        ),
        ad="tamamla",
    )
    await _event_bekle(
        okundu,
        aciklama="tamamlama tarafı ACCEPTED booking satırını hiç okumadı",
        ureticiler=(tamamla_gorevi,),
    )

    yeni_start, yeni_end = _yeni_saat()
    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, ders.booking_id)
        await booking_service.reschedule(s, booking, start_at=yeni_start, end_at=yeni_end)
        await s.commit()

    kapi.set()
    tamamlanabildi = await _gorev_bekle(
        tamamla_gorevi, aciklama="kapı açıldıktan sonra tamamlama görevi bitmedi"
    )

    assert not tamamlanabildi, (
        "KAYIP GÜNCELLEME: yeni saate taşınmış (PENDING) dersi bayat ACCEPTED "
        "okumasıyla gelen tamamlama yazabildi."
    )
    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert (booking_status, payment_status) == (
        BookingStatus.PENDING,
        PaymentStatus.HELD,
    ), (
        f"TUTARSIZ SONUÇ: booking={booking_status.value}, ödeme={payment_status}. "
        "Taşınan ders yeniden onay bekler ve parası emanette kalır."
    )
    p = await ip1a.payment(ders.booking_id)
    assert p["released_at"] is None, (
        "yeniden onaya düşmüş dersin parası eğitmene serbest bırakıldı — iade "
        "released_at yüzünden kalıcı olarak kapandı"
    )
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal("0.00")
    assert provider.refund_calls == []


async def test_tamamlama_KAZANIRSA_reschedule_DERSI_GERI_ALAMAZ(
    ip1a, provider, ip1a_http, _gec_kurali_kapat, yaris
):
    """Sıralama B: `complete` commit'lendikten sonra gelen reschedule kaybeder.

    Bu, audit'in gerçek PG'de ürettiği açığın birebir modelidir: reschedule
    bayat `ACCEPTED` ile gelir, bellek içi durum kontrolünü GEÇER ve eski kodda
    `booking.status = PENDING` atamasıyla terminal durumun üzerine yazardı.
    Ölçülen: durum · para · `released_at` damgası · **ders saatinin
    değiştirilmediği** (kaybeden taraf hiçbir alan yazmamalı). Modül 2:
    tamamlama parayı HELD bırakır; ardından öğrenci onayı tek release üretir.
    """
    ders = await ip1a.odenmis()
    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(days=40))
    once_start, once_end = await _ders_zamani(ders.booking_id)
    okundu, kapi = asyncio.Event(), asyncio.Event()
    yeni_start, yeni_end = _yeni_saat()

    async def gec_reschedule(s, booking):
        await booking_service.reschedule(
            s, booking, start_at=yeni_start, end_at=yeni_end
        )

    reschedule_gorevi = yaris(
        _gecikmeli_okuyucu(
            ders.booking_id, okundu=okundu, kapi=kapi, eylem=gec_reschedule
        ),
        ad="reschedule",
    )
    await _event_bekle(
        okundu,
        aciklama="reschedule tarafı ACCEPTED booking satırını hiç okumadı",
        ureticiler=(reschedule_gorevi,),
    )

    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, ders.booking_id)
        await booking_service.complete(s, booking)
        await s.commit()
    assert (await ip1a.payment(ders.booking_id))["released_at"] is None, (
        "eğitmen tamamlaması parayı öğrenci onayı beklemeden serbest bıraktı"
    )

    kapi.set()
    tasinabildi = await _gorev_bekle(
        reschedule_gorevi, aciklama="kapı açıldıktan sonra reschedule görevi bitmedi"
    )

    # Önce SONUÇ DURUMU ölçülür: kırıldığında hata mesajı doğrudan tutarsızlığı
    # (PENDING + RELEASED) gösterir; mekanizma iddiası (`not tasinabildi`) onun
    # ardından gelir.
    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    p_son = await ip1a.payment(ders.booking_id)
    assert (booking_status, payment_status) == (
        BookingStatus.COMPLETED,
        PaymentStatus.HELD,
    ), (
        f"TUTARSIZ SONUÇ: booking={booking_status.value}, ödeme={payment_status}, "
        f"released_at={p_son['released_at']}. Tamamlanmış ders öğrenci onayına "
        "kadar emanette kalmalı; tamamlanmamış görünen ders + dağıtılmış para olamaz."
    )
    assert not tasinabildi, (
        "KAYIP GÜNCELLEME: tamamlanmış dersin üzerine reschedule PENDING yazdı."
    )

    # Tamamlanmış ders hâlâ onaylanabilir; onay tek release üretir.
    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, ders.booking_id)
        await booking_service.confirm_by_student(s, booking)
        await s.commit()
    p = await ip1a.payment(ders.booking_id)
    assert p["status"] == PaymentStatus.RELEASED.value, (
        "tamamlanmış dersin onayı parayı eğitmene geçirmedi"
    )
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal(str(p["tutor_earning"])), (
        "kazanç iki kez sayıldı"
    )
    assert (await _ders_zamani(ders.booking_id)) == (once_start, once_end), (
        "claim'i KAYBEDEN reschedule ders saatini yine de değiştirdi — kaybeden "
        "taraf hiçbir alan yazmamalıdır"
    )
    assert provider.refund_calls == [], "tamamlanmış derste iade denemesi oluştu"
