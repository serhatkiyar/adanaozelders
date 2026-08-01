"""İP-1a P0-2 — Admin booking iptali (GERÇEK PG + GERÇEK HTTP + GERÇEK izin).

## Ölçülen iş kuralı

Admin iptali, kullanıcı iptalinden **eksik bir para yolu bırakamaz**. Admin
yetkisi "FSM'i ve iadeyi atlama yetkisi" değildir; admin daha fazla booking'e
erişebilir, daha az kural uygulayamaz.

## Bugünkü gerçek akış (`services/admin_service.py:397-404`, tam gövde)

    booking.status = BookingStatus.CANCELLED   # doğrudan atama
    ...
    await db.flush()

- FSM guard'ı yok → `COMPLETED` (ödemesi `RELEASED`) ders bile iptal edilebilir;
  kullanıcı yolu aynı geçişte 409 verir (`booking_service.py:609-613`).
- `payment_service.refund` çağrısı yok → `admin_service.py` `payment_service`/
  `escrow` import bile etmez.
- Atomik claim / `FOR UPDATE` yok → read-modify-write.
- Bildirim ve WS push yok; audit var (`api/routers/admin.py:550-557`).

## Neden gerçek HTTP zorunlu

İzin kontrolü (`require_admin_permission("bookings.manage")`) rol-izin
satırlarından okunur ve **SUPER_ADMIN bypass'ı yoktur**. Servisi doğrudan çağıran
bir test bu katmanı hiç görmez; oysa "yetkisiz admin reddedilmeli" iddiasının
tek kanıtı odur. Ayrıca audit yazımı **router'da**, servis içinde değildir —
servis testi audit'i asla ölçemez.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

from core.database import AsyncSessionLocal
from models.booking import Booking, BookingStatus
from models.payment import PaymentStatus
from services import booking_service

ADMIN_KOK = "/api/v1/admin/bookings"
BOOKING_KOK = "/api/v1/bookings"
IADE_YOLUNDA = (PaymentStatus.REFUNDING, PaymentStatus.REFUNDED)
TAM_IZIN = ["bookings.view", "bookings.manage"]


async def _tamamlanmis_ders(ip1a, ip1a_http):
    """Gerçek yoldan COMPLETED + RELEASED bir ders üretir.

    Ders geçmişe kaydırılır ve eğitmen `POST /bookings/{id}/complete` ile
    tamamlar — yani `RELEASED` durumu elle yazılmaz, `payment_service.release`
    üretir (`released_at` damgası da böylece gerçek olur).
    """
    ders = await ip1a.odenmis()
    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(days=40))
    r = await ip1a_http.post(f"{BOOKING_KOK}/{ders.booking_id}/complete", headers=ders.tutor_auth)
    assert r.status_code == 200, r.text
    assert (await ip1a.durumlar(ders.booking_id))[1] is PaymentStatus.RELEASED
    return ders


# ═══════════════════════ KIRMIZI: sözleşme henüz yazılmadı ═══════════════════


async def test_admin_iptali_EMANETI_GERCEKTEN_IADE_eder(ip1a, provider, ip1a_http):
    """P0-2 çekirdeği: admin iptali de kullanıcı iptali gibi parayı çözmeli."""
    ders = await ip1a.odenmis()
    _aid, admin_auth = await ip1a.admin(izinler=TAM_IZIN)

    r = await ip1a_http.post(
        f"{ADMIN_KOK}/{ders.booking_id}/cancel",
        json={"reason": "İP-1a: emanet iadesi ölçümü"},
        headers=admin_auth,
    )
    assert r.status_code == 200, r.text

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.CANCELLED

    assert payment_status is not PaymentStatus.HELD, (
        "ADMIN İPTALİ PARAYI EMANETTE BIRAKTI: ders CANCELLED ama ödeme HELD. "
        "Ne öğrenciye iade edildi ne eğitmene geçti; reconciler de HELD taramıyor "
        "(escrow_reconciler.py:77 REFUNDING, :171 PENDING/FAILED)."
    )
    assert payment_status in IADE_YOLUNDA
    assert len(provider.refund_calls) == 1, (
        f"sağlayıcıya {len(provider.refund_calls)} iade emri gitti (beklenen 1)"
    )
    assert provider.refund_calls[0][1] == ders.amount
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal("0.00")


async def test_admin_TAMAMLANMIS_dersi_iptal_EDEMEZ(ip1a, provider, ip1a_http):
    """RELEASED para terminaldir; iptal onu geri getiremez, o hâlde iptal de edilemez.

    `escrow.begin_refund`'ın `released_at IS NULL` guard'ı (`escrow.py:226-230`)
    parayı zaten kilitlemiş durumda. Booking'i CANCELLED'a çevirmek, "iptal
    edilmiş ders + eğitmene ödenmiş para" çelişkisi üretir ve hiçbir ekranda
    tutarlı görünmez. Kullanıcı yolu bu geçişi 409 ile reddediyor.
    """
    ders = await _tamamlanmis_ders(ip1a, ip1a_http)
    _aid, admin_auth = await ip1a.admin(izinler=TAM_IZIN)
    iade_once = len(provider.refund_calls)

    r = await ip1a_http.post(
        f"{ADMIN_KOK}/{ders.booking_id}/cancel",
        json={"reason": "İP-1a: terminal geçiş ölçümü"},
        headers=admin_auth,
    )
    assert r.status_code == 409, (
        f"tamamlanmış (parası serbest bırakılmış) ders admin tarafından iptal "
        f"edilebildi — {r.status_code} döndü, 409 beklenir"
    )

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.COMPLETED, (
        "409'a rağmen booking durumu değişti"
    )
    assert payment_status is PaymentStatus.RELEASED
    assert len(provider.refund_calls) == iade_once, (
        "serbest bırakılmış emanete iade emri gönderildi"
    )


async def test_admin_iptali_HER_IKI_TARAFI_bilgilendirir(ip1a, provider, ip1a_http):
    """Dersi admin iptal ettiyse taraflar bunu ekranlarından öğrenemez.

    Kullanıcı iptalinde karşı tarafa bildirim gider (`booking_service.py:618-640`)
    ve iade bildirimi ayrıca yazılır. Admin yolunda `notification_service` hiç
    import edilmemiş — yani eğitmen dersin iptal edildiğini hiç öğrenmez.
    """
    ders = await ip1a.odenmis()
    _aid, admin_auth = await ip1a.admin(izinler=TAM_IZIN)
    tutor_once = await ip1a.bildirim_sayisi(user_id=ders.tutor_id, role_id=2)
    client_once = await ip1a.bildirim_sayisi(user_id=ders.client_id, role_id=3)

    await ip1a_http.post(
        f"{ADMIN_KOK}/{ders.booking_id}/cancel",
        json={"reason": "İP-1a: bildirim ölçümü"},
        headers=admin_auth,
    )

    assert await ip1a.bildirim_sayisi(user_id=ders.tutor_id, role_id=2) > tutor_once, (
        "eğitmene admin iptali bildirilmedi"
    )
    assert await ip1a.bildirim_sayisi(user_id=ders.client_id, role_id=3) > client_once, (
        "öğrenciye admin iptali/iadesi bildirilmedi"
    )


async def test_admin_iptali_TEKRARI_cift_iade_uretmez(ip1a, provider, ip1a_http):
    """Aynı admin isteğinin tekrarı ikinci para hareketi doğuramaz.

    Birinci çağrının GERÇEKTEN bir iade ürettiği önce sabitlenir; aksi halde
    "iade hiç olmadığı için ikinci de olmadı" biçiminde boş bir yeşil çıkardı.
    """
    ders = await ip1a.odenmis()
    _aid, admin_auth = await ip1a.admin(izinler=TAM_IZIN)
    govde = {"reason": "İP-1a: idempotency ölçümü"}

    ilk = await ip1a_http.post(f"{ADMIN_KOK}/{ders.booking_id}/cancel", json=govde, headers=admin_auth)
    assert ilk.status_code == 200, ilk.text
    assert len(provider.refund_calls) == 1, (
        f"ilk admin iptali {len(provider.refund_calls)} iade üretti (beklenen 1)"
    )

    ikinci = await ip1a_http.post(
        f"{ADMIN_KOK}/{ders.booking_id}/cancel",
        json={"reason": "İP-1a: ikinci deneme"},
        headers=admin_auth,
    )
    assert ikinci.status_code == 409, (
        f"zaten iptal edilmiş derse ikinci iptal {ikinci.status_code} döndü; "
        "200 sessizce başarı sayar, ilk gerekçeyi ezer ve ikinci audit satırı yazar"
    )
    assert len(provider.refund_calls) == 1, (
        f"ÇİFT İADE: {len(provider.refund_calls)} emir gitti"
    )


# ═══════════════════════ YEŞİL NÖBETÇİLER ════════════════════════════════════


async def test_YESIL_admin_iptali_AUDIT_izi_birakir(ip1a, provider, ip1a_http):
    """Denetim kaydı bugün çalışıyor ve çalışmaya devam etmeli.

    P0-2 düzeltmesi servis katmanını değiştirecek; audit yazımı router'da
    durduğu için yanlışlıkla düşürülebilir. Bu nöbetçi onu tutar.
    """
    ders = await ip1a.odenmis()
    _aid, admin_auth = await ip1a.admin(izinler=TAM_IZIN)

    r = await ip1a_http.post(
        f"{ADMIN_KOK}/{ders.booking_id}/cancel",
        json={"reason": "İP-1a: audit ölçümü"},
        headers=admin_auth,
    )
    assert r.status_code == 200, r.text
    assert await ip1a.audit_sayisi(target_id=ders.booking_id, action="booking.cancel") == 1


async def test_YESIL_izinsiz_admin_iptal_EDEMEZ(ip1a, provider, ip1a_http):
    """`bookings.manage` izni olmayan admin 403 alır — ve para hiç kıpırdamaz."""
    ders = await ip1a.odenmis()
    _aid, zayif_auth = await ip1a.admin(izinler=["dashboard.view"])

    r = await ip1a_http.post(
        f"{ADMIN_KOK}/{ders.booking_id}/cancel",
        json={"reason": "İP-1a: yetki ölçümü"},
        headers=zayif_auth,
    )
    assert r.status_code == 403, f"izinsiz admin iptal edebildi ({r.status_code})"

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.ACCEPTED
    assert payment_status is PaymentStatus.HELD
    assert provider.refund_calls == []
    assert await ip1a.audit_sayisi(target_id=ders.booking_id, action="booking.cancel") == 0


async def test_YESIL_tutor_ve_client_admin_ucuna_ERISEMEZ(ip1a, provider, ip1a_http):
    """Rol kapısı router seviyesinde; taraflar admin iptalini kullanamaz."""
    ders = await ip1a.odenmis()
    govde = {"reason": "İP-1a: rol ölçümü"}

    for baslik, ad in ((ders.tutor_auth, "TUTOR"), (ders.client_auth, "CLIENT")):
        r = await ip1a_http.post(
            f"{ADMIN_KOK}/{ders.booking_id}/cancel", json=govde, headers=baslik
        )
        assert r.status_code == 403, f"{ad} admin iptal ucuna erişti ({r.status_code})"

    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.ACCEPTED,
        PaymentStatus.HELD,
    )
    assert provider.refund_calls == []


async def test_YESIL_token_yoksa_401(ip1a, provider, ip1a_http):
    """Anonim istek kimlik doğrulamada düşer, yetkilendirmede değil."""
    ders = await ip1a.odenmis()
    r = await ip1a_http.post(
        f"{ADMIN_KOK}/{ders.booking_id}/cancel", json={"reason": "İP-1a"}
    )
    assert r.status_code == 401, r.status_code
    assert provider.refund_calls == []


async def test_YESIL_admin_dispute_isaretleyebilir(ip1a, provider, ip1a_http):
    """Dispute ucu çalışıyor — P0-4'ün kurulum aracının kanıtı.

    P0-4 testleri "ihtilaflı ders otomatik tamamlanmamalı" diyor; o iddianın
    anlamlı olması için önce dersin GERÇEKTEN ihtilaflı işaretlenebildiğini
    göstermek gerekir. Aksi halde kırmızılık bayrağın hiç konmamasından da
    kaynaklanıyor olabilirdi.
    """
    ders = await ip1a.odenmis()
    _aid, admin_auth = await ip1a.admin(izinler=TAM_IZIN)

    r = await ip1a_http.post(
        f"{ADMIN_KOK}/{ders.booking_id}/dispute",
        json={"is_disputed": True, "admin_notes": "İP-1a nöbetçi"},
        headers=admin_auth,
    )
    assert r.status_code == 200, r.text

    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, ders.booking_id)
        assert booking.is_disputed is True, "dispute bayrağı DB'ye yazılmadı"
    assert await ip1a.audit_sayisi(target_id=ders.booking_id, action="booking.dispute") == 1


async def test_YESIL_kullanici_yolu_terminal_gecisi_REDDEDER(ip1a, provider, ip1a_http):
    """Kıyas noktası: aynı geçiş kullanıcı yolunda 409 alır.

    Bu nöbetçi P0-2'nin "admin yolu eksik" iddiasını ölçülebilir kılar: kural
    sistemde ZATEN var, yalnız admin yolu ondan muaf tutulmuş.
    """
    ders = await _tamamlanmis_ders(ip1a, ip1a_http)
    iade_once = len(provider.refund_calls)

    r = await ip1a_http.post(
        f"{BOOKING_KOK}/{ders.booking_id}/cancel",
        json={"reason": "İP-1a: kıyas"},
        headers=ders.client_auth,
    )
    assert r.status_code == 409, (
        f"kullanıcı tamamlanmış dersi iptal edebildi ({r.status_code})"
    )
    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.COMPLETED,
        PaymentStatus.RELEASED,
    )
    assert len(provider.refund_calls) == iade_once


async def test_YESIL_servis_katmani_admin_yolunu_da_baglar(ip1a, provider):
    """Servis doğrudan çağrıldığında da aynı sözleşme geçerlidir.

    HTTP testi kablolamayı ölçer; bu test kuralın **router'da değil serviste**
    yaşadığını sabitler. Kural yalnız uca konursa, arka plan işleri veya ileride
    eklenecek başka bir çağıran onu sessizce atlar.
    """
    ders = await ip1a.odenmis()
    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, ders.booking_id)
        await booking_service.cancel(s, booking, cancelled_by=await _client(s, ders))
        await s.commit()

    _bs, payment_status = await ip1a.durumlar(ders.booking_id)
    assert payment_status in IADE_YOLUNDA
    assert len(provider.refund_calls) == 1


async def _client(s, ders):
    from models.client import Client

    return await s.get(Client, ders.client_id)
