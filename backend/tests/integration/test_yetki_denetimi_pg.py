"""Yetki denetimi (28 Eyl 2026) — gerçek Postgres + gerçek HTTP uçları.

Her test, düzeltilen bir yetki açığını saldırganın göndereceği istekle
sınar; dependency override YOK, token'lar gerçek imzalıdır.

1. Eğitmen, admin'in yayından kaldırdığı ilanı `/tutors/me/activate` ile
   kendisi geri açabiliyordu (self-servis "Pasife al" ile aynı durum).
2. Öğrenci, eğitmenin teklifini erteleyip yeni saati kendisi onaylayabiliyordu
   (`offered_by_tutor` ertelemede sıfırlanmıyordu).
3. Moderasyonla gizlenen yorum silinip aynı dersle yeniden yazılabiliyordu.
4. `srs_platform.manage` izni olmayan admin, kullanıcı uçlarından platform
   destesine not yazabiliyordu.
5. Kütüphane operatörü / eğitmen, görsel alanına başkasının public nesne
   anahtarını yazabiliyordu; sonraki görsel yüklemesi o nesneyi siliyordu.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

from sqlalchemy import select, text

from core import storage
from core.database import AsyncSessionLocal
from models.booking import Booking, BookingStatus
from models.library import Library
from models.payment import Payment, PaymentStatus
from models.store import Product
from models.tutor import Tutor, TutorStatus
from tests.integration.db_guard import purge_products
from tests.integration.ip1a_factory import pencere_ici_an, tum_hafta_musaitlik
from tests.integration.ip16_factory import deste
from tests.integration.ip3_factory import yetki_basligi

API = "/api/v1"
BASKASININ_NESNESI = "profiles/baska-kullanicinin-avatari.webp"


async def _tutor_durumu(tutor_id: int) -> tuple[TutorStatus, datetime.datetime | None]:
    async with AsyncSessionLocal() as s:
        t = await s.get(Tutor, tutor_id)
        return t.status, t.suspended_by_admin_at


# ── 1. Admin askısı eğitmen tarafından geri alınamaz ─────────────────────────


async def test_admin_yayindan_kaldirdigi_ilani_egitmen_geri_acamaz(ip3, http):
    egitmen = await ip3.tutor()
    admin = await ip3.admin(permissions=["tutors.manage"])
    e_hdr, a_hdr = yetki_basligi(egitmen), yetki_basligi(admin)

    r = await http.post(f"{API}/admin/tutors/{egitmen.id}/suspend", headers=a_hdr)
    assert r.status_code == 200, r.text[:200]

    r = await http.post(f"{API}/tutors/me/activate", headers=e_hdr)
    assert r.status_code == 403, (
        f"eğitmen admin kararını kendisi geri aldı ({r.status_code})"
    )
    assert (await _tutor_durumu(egitmen.id))[0] == TutorStatus.SUSPENDED

    # Kararı yalnız admin geri alır; işaret temizlenir.
    r = await http.post(f"{API}/admin/tutors/{egitmen.id}/activate", headers=a_hdr)
    assert r.status_code == 200, r.text[:200]
    assert await _tutor_durumu(egitmen.id) == (TutorStatus.APPROVED, None)

    # Self-servis "Pasife al" / "Aktifleştir" eskisi gibi çalışır.
    assert (await http.post(f"{API}/tutors/me/suspend", headers=e_hdr)).status_code == 200
    assert (await http.post(f"{API}/tutors/me/activate", headers=e_hdr)).status_code == 200


async def test_kendi_pasife_aldigi_ilana_admin_karari_yine_islenir(ip3, http):
    """"Önce pasife al, sonra aktifleştir" admin kararını boşa çıkaramaz."""
    egitmen = await ip3.tutor()
    admin = await ip3.admin(permissions=["tutors.manage"])
    e_hdr, a_hdr = yetki_basligi(egitmen), yetki_basligi(admin)

    assert (await http.post(f"{API}/tutors/me/suspend", headers=e_hdr)).status_code == 200
    r = await http.post(f"{API}/admin/tutors/{egitmen.id}/suspend", headers=a_hdr)
    assert r.status_code == 200, r.text[:200]

    r = await http.post(f"{API}/tutors/me/activate", headers=e_hdr)
    assert r.status_code == 403
    durum, isaret = await _tutor_durumu(egitmen.id)
    assert durum == TutorStatus.SUSPENDED and isaret is not None


# ── 2. Öğrenci ertelediği teklifi kendisi onaylayamaz ────────────────────────


async def test_ertelenen_teklifi_ogrenci_kendi_onaylayamaz(ip3, http):
    egitmen = await ip3.tutor()
    ogrenci = await ip3.client()
    baslangic = pencere_ici_an(5)
    async with AsyncSessionLocal() as s:
        s.add_all(tum_hafta_musaitlik(egitmen.id))
        b = Booking(
            tutor_id=egitmen.id,
            client_id=ogrenci.id,
            status=BookingStatus.PENDING,
            offered_by_tutor=True,
            start_at=baslangic,
            end_at=baslangic + datetime.timedelta(hours=1),
            price=Decimal("400.00"),
            mode="ONLINE",
        )
        s.add(b)
        await s.commit()
        booking_id = b.id
    ip3.booking_ids.append(booking_id)
    o_hdr, e_hdr = yetki_basligi(ogrenci), yetki_basligi(egitmen)

    yeni = baslangic + datetime.timedelta(days=1)
    r = await http.post(
        f"{API}/bookings/{booking_id}/reschedule",
        headers=o_hdr,
        json={
            "start_at": yeni.isoformat(),
            "end_at": (yeni + datetime.timedelta(hours=1)).isoformat(),
        },
    )
    assert r.status_code == 200, r.text[:200]

    # Yeni saati öğrenci seçti; yanıt artık eğitmende.
    r = await http.post(f"{API}/bookings/{booking_id}/accept", headers=o_hdr)
    assert r.status_code == 403, (
        f"öğrenci kendi önerdiği saati kendisi onayladı ({r.status_code})"
    )
    async with AsyncSessionLocal() as s:
        b = await s.get(Booking, booking_id)
        assert b.status == BookingStatus.PENDING and b.offered_by_tutor is False

    r = await http.post(f"{API}/bookings/{booking_id}/accept", headers=e_hdr)
    assert r.status_code == 200, r.text[:200]
    assert r.json()["status"] == BookingStatus.ACCEPTED.value
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("DELETE FROM payments WHERE booking_id = :b"), {"b": booking_id}
        )
        await s.commit()


# ── 3. Gizlenen yorum sil + yeniden yaz ile geri getirilemez ─────────────────


async def test_gizlenen_yorum_silinip_yeniden_yazilamaz(ip3, http):
    egitmen = await ip3.tutor()
    ogrenci = await ip3.client()
    booking = await ip3.booking(egitmen, ogrenci, status=BookingStatus.COMPLETED)
    async with AsyncSessionLocal() as s:
        s.add(
            Payment(
                booking_id=booking.id,
                amount=Decimal("400.00"),
                commission_amount=Decimal("40.00"),
                tutor_earning=Decimal("360.00"),
                commission_rate=Decimal("0.1000"),
                currency="TRY",
                status=PaymentStatus.RELEASED,
                provider="fake",
                provider_ref="cf-yetki-denetimi",
            )
        )
        await s.commit()
    yorum = await ip3.review(booking, rating=1)
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE reviews SET hidden_at = now() WHERE id = :i"), {"i": yorum.id}
        )
        await s.commit()
    o_hdr = yetki_basligi(ogrenci)

    try:
        r = await http.delete(f"{API}/reviews/{yorum.id}", headers=o_hdr)
        assert r.status_code == 204, r.text[:200]

        r = await http.post(
            f"{API}/reviews",
            headers=o_hdr,
            json={
                "booking_id": booking.id,
                "rating": 1,
                "clarity_rating": 1,
                "motivation_rating": 1,
                "preparation_rating": 1,
                "comment_text": "moderasyonu atlatan yeni yorum",
            },
        )
        assert r.status_code == 409, (
            f"gizlenen yorum silinip yeniden yazıldı ({r.status_code})"
        )
    finally:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("DELETE FROM payments WHERE booking_id = :b"), {"b": booking.id}
            )
            await s.commit()


# ── 4. Platform destesine yazım `srs_platform.manage` ister ──────────────────


async def test_izinsiz_admin_platform_destesine_not_yazamaz(ip16, ip16_http):
    _yid, yetkili = await ip16.admin(izinler=["srs_platform.view", "srs_platform.manage"])
    _iid, izinsiz = await ip16.admin(izinler=["products.manage"])
    r = await ip16_http.post(
        f"{API}/srs/admin/platform-decks", headers=yetkili, json={"name": "Platform"}
    )
    assert r.status_code == 201, r.text[:200]
    deck_id = r.json()["id"]
    not_govdesi = {"note_type": "BASIC", "front": "soru", "back": "cevap", "tags": []}

    r = await ip16_http.post(
        f"{API}/srs/decks/{deck_id}/notes", headers=izinsiz, json=not_govdesi
    )
    assert r.status_code == 404, (
        f"izinsiz admin platform destesine not yazdı ({r.status_code})"
    )

    r = await ip16_http.post(
        f"{API}/srs/decks/{deck_id}/notes", headers=yetkili, json=not_govdesi
    )
    assert r.status_code == 201, r.text[:200]
    note_id = r.json()["id"]
    r = await ip16_http.patch(
        f"{API}/srs/notes/{note_id}", headers=izinsiz, json={"front": "değişti"}
    )
    assert r.status_code == 404
    r = await ip16_http.delete(f"{API}/srs/notes/{note_id}", headers=izinsiz)
    assert r.status_code == 404

    # İzinsiz adminin KENDİ özel destesi etkilenmez.
    kendi = await deste(ip16_http, izinsiz)
    r = await ip16_http.post(
        f"{API}/srs/decks/{kendi['id']}/notes", headers=izinsiz, json=not_govdesi
    )
    assert r.status_code == 201, r.text[:200]


# ── 5. Görsel alanına başkasının nesne anahtarı yazılamaz ────────────────────


async def test_operator_logo_kapak_adresini_elle_yazamaz(ip3, http):
    lib = await ip3.library()
    operator = await ip3.operator(lib)
    admin = await ip3.admin(permissions=["libraries.manage"])

    # Saldırgan, herhangi bir API yanıtında gördüğü CDN adresini gönderir;
    # şema onu anahtara çevirir (`PublicAssetInput`).
    r = await http.patch(
        f"{API}/libraries/{lib.id}",
        headers=yetki_basligi(operator),
        json={
            "logo_url": storage.public_url(BASKASININ_NESNESI),
            "cover_url": storage.public_url("library-photos/baska-kutuphane.webp"),
            "description": "Operatör açıklaması",
        },
    )
    assert r.status_code == 200, r.text[:200]
    async with AsyncSessionLocal() as s:
        kayit = await s.get(Library, lib.id)
        assert kayit.logo_url is None and kayit.cover_url is None, (
            "operatör görsel alanına elle anahtar yazdı; sonraki yükleme onu siler"
        )
        assert kayit.description == "Operatör açıklaması"

    # Admin küratör yolu korunur.
    r = await http.patch(
        f"{API}/libraries/{lib.id}",
        headers=yetki_basligi(admin),
        json={"logo_url": storage.public_url("library-photos/kuratorun-sectigi.webp")},
    )
    assert r.status_code == 200, r.text[:200]
    async with AsyncSessionLocal() as s:
        assert (await s.get(Library, lib.id)).logo_url == "library-photos/kuratorun-sectigi.webp"


async def test_egitmen_urun_kapak_adresini_elle_yazamaz(ip3, http):
    egitmen = await ip3.tutor()
    e_hdr = yetki_basligi(egitmen)
    r = await http.post(
        f"{API}/store/seller/products",
        headers=e_hdr,
        json={
            "title": "Deneme Notları",
            "price": "100.00",
            "tax_rate": "0.20",
            "cover_url": BASKASININ_NESNESI,
        },
    )
    assert r.status_code in (200, 201), r.text[:200]
    product_id = r.json()["id"]
    try:
        r = await http.patch(
            f"{API}/store/seller/products/{product_id}",
            headers=e_hdr,
            json={"cover_url": BASKASININ_NESNESI, "description": "Güncel"},
        )
        assert r.status_code == 200, r.text[:200]
        async with AsyncSessionLocal() as s:
            p = (
                await s.execute(select(Product).where(Product.id == product_id))
            ).scalar_one()
            assert p.cover_url is None, (
                "eğitmen kapak alanına başkasının nesne anahtarını yazdı"
            )
    finally:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("DELETE FROM product_price_history WHERE product_id = :i"),
                {"i": product_id},
            )
            await purge_products(s, [product_id])
