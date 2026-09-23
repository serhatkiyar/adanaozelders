"""Değerlendirme: öğrenci–öğretmen tekilliği, anonimlik, "Düzenlendi" ve sayaçlar.

Gerçek Postgres + gerçek ASGI uygulaması (dependency override yok):

- Değerlendirme (client_id, tutor_id) çiftine aittir; aynı öğretmenle yapılan
  her dersin detayından aynı kayda ulaşılır. Eşzamanlı iki oluşturma isteğinde
  ikinci kayıt uq_reviews_client_tutor_active index'ine takılır → 409.
- Anonim değerlendirmede sahibi olmayana (public, öğretmen, izinsiz admin)
  client_id / booking_id / ad / fotoğraf gitmez; ders detayı ve listesindeki
  `reviewed` / `can_review` işaretleri de yazarı ele vermez.
- `edited_at` yalnız puan/alt kriter/yorum gerçekten değişince güncellenir.
- Gizli yorumun puanı düzenlenir ya da yorum silinirse sayaçlar bozulmaz.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from core.database import AsyncSessionLocal
from models.client import Client
from models.review import Review
from models.tutor import Tutor
from schemas.review import ReviewCreate
from services import content_moderation, review_service
from tests.integration.ip3_factory import yetki_basligi

KOK = "/api/v1/reviews"


async def _sayac(tutor_id: int) -> tuple[int, int]:
    async with AsyncSessionLocal() as s:
        t = await s.get(Tutor, tutor_id)
        return t.rating_count, t.rating_sum


async def _anonim_yap(review_id: int) -> None:
    async with AsyncSessionLocal() as s:
        r = await s.get(Review, review_id)
        r.is_anonymous = True
        await s.commit()


class _Admin:
    id = 0


def _odenmis_say(monkeypatch) -> None:
    """Ödeme kuralını karşılanmış say; öğretmen/tekillik kuralı gerçek kalır.
    (Fabrika dersleri ödemesizdir; can_review aksi halde hep False olurdu ve
    sızıntı testi hiçbir şey kanıtlamazdı.)"""
    from models.payment import Payment, PaymentStatus

    gercek = review_service.degerlendirme_engeli

    def sahte(booking, _payment, *, saglayici, **k):
        odeme = Payment(status=PaymentStatus.RELEASED, provider=saglayici)
        return gercek(booking, odeme, saglayici=saglayici, **k)

    monkeypatch.setattr(review_service, "degerlendirme_engeli", sahte)


@pytest.mark.asyncio
async def test_esitmanli_iki_olusturma_tek_kayit_birakir(ip3, monkeypatch):
    """Servis kontrolünü ikisi birden geçse de veritabanı ikinciyi reddeder."""
    egitmen = await ip3.tutor()
    ogrenci = await ip3.client()
    a = await ip3.booking(egitmen, ogrenci)
    b = await ip3.booking(egitmen, ogrenci)
    # Yarışı taklit et: iki istek de "henüz değerlendirmedi" kararını görür.
    monkeypatch.setattr(review_service, "degerlendirme_engeli", lambda *a, **k: None)

    async def olustur(booking_id: int):
        async with AsyncSessionLocal() as s:
            client = await s.get(Client, ogrenci.id)
            try:
                out = await review_service.create_review(
                    s, client, ReviewCreate(booking_id=booking_id, rating=5)
                )
                await s.commit()
                return out
            except HTTPException as exc:
                await s.rollback()
                return exc

    sonuc = await asyncio.gather(olustur(a.id), olustur(b.id))
    hatalar = [x for x in sonuc if isinstance(x, HTTPException)]
    assert len(hatalar) == 1 and hatalar[0].status_code == 409

    async with AsyncSessionLocal() as s:
        aktif = (
            await s.scalars(
                select(Review).where(
                    Review.client_id == ogrenci.id,
                    Review.tutor_id == egitmen.id,
                    Review.deleted_at.is_(None),
                )
            )
        ).all()
    assert len(aktif) == 1
    assert await _sayac(egitmen.id) == (1, 5), "reddedilen istek sayacı artırmamalı"


@pytest.mark.asyncio
async def test_soft_delete_sonrasi_yeni_degerlendirme_serbest(ip3, monkeypatch):
    egitmen = await ip3.tutor()
    ogrenci = await ip3.client()
    booking = await ip3.booking(egitmen, ogrenci)
    eski = await ip3.review(booking)
    async with AsyncSessionLocal() as s:
        r = await s.get(Review, eski.id)
        await review_service.delete_review(s, r)
        await s.commit()
    monkeypatch.setattr(review_service, "degerlendirme_engeli", lambda *a, **k: None)
    async with AsyncSessionLocal() as s:
        client = await s.get(Client, ogrenci.id)
        out = await review_service.create_review(
            s, client, ReviewCreate(booking_id=booking.id, rating=4)
        )
        await s.commit()
    assert out.id != eski.id


@pytest.mark.asyncio
async def test_farkli_derslerden_ayni_degerlendirme(ip3, http):
    egitmen = await ip3.tutor()
    ogrenci = await ip3.client()
    ilk = await ip3.booking(egitmen, ogrenci)
    ikinci = await ip3.booking(egitmen, ogrenci)
    review = await ip3.review(ilk)

    r = await http.get(f"{KOK}/booking/{ikinci.id}", headers=yetki_basligi(ogrenci))
    assert r.status_code == 200 and r.json()["id"] == review.id

    p = await http.patch(
        f"{KOK}/{review.id}", json={"rating": 3}, headers=yetki_basligi(ogrenci)
    )
    assert p.status_code == 200
    r = await http.get(f"{KOK}/booking/{ilk.id}", headers=yetki_basligi(ogrenci))
    assert r.json()["rating"] == 3


@pytest.mark.asyncio
async def test_anonim_gorunurluk(ip3, http, monkeypatch):
    _odenmis_say(monkeypatch)
    egitmen = await ip3.tutor()
    ogrenci = await ip3.client()
    booking = await ip3.booking(egitmen, ogrenci)
    review = await ip3.review(booking)
    await _anonim_yap(review.id)
    kimlik = ("client_id", "booking_id", "client_name", "client_avatar_url")

    # Ziyaretçi (public liste)
    liste = (await http.get(KOK, params={"tutor_id": egitmen.id})).json()
    kayit = next(x for x in liste if x["id"] == review.id)
    assert all(kayit[k] is None for k in kimlik)
    assert str(ogrenci.id) not in str({k: kayit[k] for k in kimlik})

    # Öğretmen: ders üzerinden göremez, id ile görürse kimliksiz görür.
    th = yetki_basligi(egitmen)
    assert (await http.get(f"{KOK}/booking/{booking.id}", headers=th)).json() is None
    tek = (await http.get(f"{KOK}/{review.id}", headers=th)).json()
    assert all(tek[k] is None for k in kimlik)

    # Öğretmenin ders detayı ve listesi yazarı ele vermez.
    detay = (await http.get(f"/api/v1/bookings/{booking.id}", headers=th)).json()
    assert detay["reviewed"] is False and detay["can_review"] is False
    # Kıyas: değerlendirmesi OLMAYAN bir öğrencinin dersi öğretmene aynı görünür.
    diger = await ip3.booking(egitmen, await ip3.client())
    d2 = (await http.get(f"/api/v1/bookings/{diger.id}", headers=th)).json()
    assert (d2["reviewed"], d2["can_review"]) == (detay["reviewed"], detay["can_review"])
    satirlar = (await http.get("/api/v1/bookings", headers=th)).json()
    satirlar = satirlar.get("items", satirlar) if isinstance(satirlar, dict) else satirlar
    satir = next(x for x in satirlar if x["id"] == booking.id)
    assert satir["reviewed"] is False

    # Sahibi normal görür.
    sahip = (
        await http.get(f"{KOK}/booking/{booking.id}", headers=yetki_basligi(ogrenci))
    ).json()
    assert sahip["client_id"] == ogrenci.id and sahip["client_name"] is not None
    ogrenci_detay = (
        await http.get(f"/api/v1/bookings/{booking.id}", headers=yetki_basligi(ogrenci))
    ).json()
    assert ogrenci_detay["reviewed"] is True

    # Admin: moderasyon izniyle görür, izinsiz göremez.
    yetkili = await ip3.admin(permissions=["reports.view"])
    r = await http.get(f"{KOK}/booking/{booking.id}", headers=yetki_basligi(yetkili))
    assert r.json()["client_id"] == ogrenci.id
    izinsiz = await ip3.admin(permissions=[])
    r = await http.get(f"{KOK}/{review.id}", headers=yetki_basligi(izinsiz))
    assert all(r.json()[k] is None for k in kimlik)


@pytest.mark.asyncio
async def test_anonim_olmayan_ogretmene_adiyla_gorunur(ip3, http):
    egitmen = await ip3.tutor()
    ogrenci = await ip3.client()
    booking = await ip3.booking(egitmen, ogrenci)
    await ip3.review(booking)
    r = await http.get(f"{KOK}/booking/{booking.id}", headers=yetki_basligi(egitmen))
    assert r.json()["client_name"] == ogrenci.first_name


@pytest.mark.asyncio
async def test_edited_at_kurallari(ip3, http):
    egitmen = await ip3.tutor()
    ogrenci = await ip3.client()
    review = await ip3.review(await ip3.booking(egitmen, ogrenci))
    h = yetki_basligi(ogrenci)

    async def patch(body):
        r = await http.patch(f"{KOK}/{review.id}", json=body, headers=h)
        assert r.status_code == 200, r.text
        return r.json()["edited_at"]

    assert await patch({"is_anonymous": True}) is None, "yalnız anonimlik"
    assert await patch({"rating": 5, "comment_text": "IP3 test yorumu"}) is None, "no-op"

    # Moderasyon edited_at'e dokunmaz.
    async with AsyncSessionLocal() as s:
        await content_moderation.hide(
            s, target_type="REVIEW", target_id=review.id, admin=_Admin()
        )
        await content_moderation.unhide(s, target_type="REVIEW", target_id=review.id)
        await s.commit()
        assert (await s.get(Review, review.id)).edited_at is None

    ilk = await patch({"motivation_rating": 4})
    assert ilk is not None, "alt kriter değişikliği"
    assert await patch({"is_anonymous": False}) == ilk, "anonimlik edited_at'i ilerletmez"
    assert await patch({"motivation_rating": None}) not in (None, ilk), "temizlemek düzenlemedir"
    son = await patch({"comment_text": "Yeni metin"})
    assert son is not None


@pytest.mark.asyncio
@pytest.mark.parametrize("puan, kod", [(1, 200), (5, 200), (0, 422), (6, 422), (None, 422)])
async def test_genel_puan_sinirlari(ip3, http, puan, kod):
    egitmen = await ip3.tutor()
    ogrenci = await ip3.client()
    review = await ip3.review(await ip3.booking(egitmen, ogrenci))
    r = await http.patch(
        f"{KOK}/{review.id}", json={"rating": puan}, headers=yetki_basligi(ogrenci)
    )
    assert r.status_code == kod


@pytest.mark.asyncio
async def test_gizli_yorum_duzenleme_ve_silme_sayaci_bozmaz(ip3, http):
    egitmen = await ip3.tutor()
    ogrenci = await ip3.client()
    booking = await ip3.booking(egitmen, ogrenci)
    # Sayaçlar servis yoluyla tutarlı başlasın.
    async with AsyncSessionLocal() as s:
        await s.execute(
            review_service._adjust_tutor_rating(egitmen.id, 1, 5)  # noqa: SLF001
        )
        await s.commit()
    review = await ip3.review(booking, rating=5)
    assert await _sayac(egitmen.id) == (1, 5)

    async with AsyncSessionLocal() as s:
        await content_moderation.hide(
            s, target_type="REVIEW", target_id=review.id, admin=_Admin()
        )
        await s.commit()
    assert await _sayac(egitmen.id) == (0, 0)

    h = yetki_basligi(ogrenci)
    assert (
        await http.patch(f"{KOK}/{review.id}", json={"rating": 2}, headers=h)
    ).status_code == 200
    assert await _sayac(egitmen.id) == (0, 0), "gizliyken puan değişikliği sayaca yansımaz"

    async with AsyncSessionLocal() as s:
        await content_moderation.unhide(s, target_type="REVIEW", target_id=review.id)
        await s.commit()
    assert await _sayac(egitmen.id) == (1, 2), "geri açılınca GÜNCEL puan eklenir"

    async with AsyncSessionLocal() as s:
        await content_moderation.hide(
            s, target_type="REVIEW", target_id=review.id, admin=_Admin()
        )
        await s.commit()
    assert (await http.delete(f"{KOK}/{review.id}", headers=h)).status_code == 204
    assert await _sayac(egitmen.id) == (0, 0), "gizli yorum silinince iki kez düşülmez"


@pytest.mark.asyncio
async def test_alt_kriter_ortalamalari_null_saymaz(ip3, http):
    egitmen = await ip3.tutor()
    puanlar = [(5, 5, None), (3, None, None)]
    for genel, netlik, hazirlik in puanlar:
        ogrenci = await ip3.client()
        r = await ip3.review(await ip3.booking(egitmen, ogrenci), rating=genel)
        async with AsyncSessionLocal() as s:
            k = await s.get(Review, r.id)
            k.clarity_rating = netlik
            k.preparation_rating = hazirlik
            await s.commit()
    ozet = (
        await http.get(f"{KOK}/distribution", params={"tutor_id": egitmen.id})
    ).json()
    assert ozet["count"] == 2 and ozet["average"] == 4.0
    assert ozet["clarity_average"] == 5.0, "NULL netlik ortalamaya girmez"
    assert ozet["motivation_average"] is None
    assert ozet["preparation_average"] is None
