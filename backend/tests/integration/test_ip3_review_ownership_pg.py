"""İP-3 / Bulgu 5 — `GET /reviews/booking/{id}` booking sahipliğini sormuyor.

## Doğrulanan üretim durumu

`api/routers/reviews.py`:

    @router.get("/booking/{booking_id}", response_model=ReviewOut | None)
    async def get_review_by_booking(
        booking_id: int,
        _user: CurrentUser = Depends(get_current_active_user),   # yalnız "giriş yapmış"
        ...

Herhangi bir oturumlu kullanıcı ardışık booking id'leri gezerek "bu ders kimin
ve değerlendirilmiş mi" haritasını çıkarabilir: `ReviewOut` `client_id`,
`tutor_id`, `booking_id`, puan ve yorum metnini taşır.

Aynı kaynağın üç kontrolü bugün ayrı: GET (kontrolsüz), PATCH ve DELETE
(`_assert_owner`, yalnız yorum sahibi CLIENT), reply (yalnız tutor). Bu drift
tam da tek bir yolun unutulmasının sebebi.

## Güvenlik sözleşmesi

1. `GET /reviews/booking/{id}` yalnız o booking'in öğrencisi, eğitmeni veya
   yetkili admin tarafından okunabilir.
2. Yabancı booking id'si varlık bilgisi sızdırmaz (var olan yabancı booking ile
   hiç olmayan id aynı yanıtı verir).
3. Sahiplik kararı tek bir ortak yardımcıda verilir — router'da kopyalanmaz.
"""
from __future__ import annotations

import pytest

from models.booking import BookingStatus
from tests.integration.ip3_factory import yetki_basligi

KOK = "/api/v1/reviews"


@pytest.mark.asyncio
async def test_yabanci_ogrenci_baskasinin_booking_reviewunu_okuyamaz(ip3, http):
    """Senaryo 11 — ilişkisiz CLIENT."""
    egitmen = await ip3.tutor()
    ogrenci = await ip3.client()
    yabanci = await ip3.client()
    booking = await ip3.booking(egitmen, ogrenci, status=BookingStatus.COMPLETED)
    await ip3.review(booking)

    r = await http.get(f"{KOK}/booking/{booking.id}", headers=yetki_basligi(yabanci))

    assert r.status_code == 404, (
        f"yabancı öğrenci başkasının ders değerlendirmesini okudu ({r.status_code}): "
        f"{r.text[:200]}"
    )


@pytest.mark.asyncio
async def test_yabanci_egitmen_baskasinin_booking_reviewunu_okuyamaz(ip3, http):
    """İlişkisiz TUTOR da aynı kapıya çarpmalı."""
    egitmen = await ip3.tutor()
    yabanci_egitmen = await ip3.tutor()
    ogrenci = await ip3.client()
    booking = await ip3.booking(egitmen, ogrenci, status=BookingStatus.COMPLETED)
    await ip3.review(booking)

    r = await http.get(
        f"{KOK}/booking/{booking.id}", headers=yetki_basligi(yabanci_egitmen)
    )

    assert r.status_code == 404, (
        f"yabancı eğitmen başka dersin değerlendirmesini okudu ({r.status_code})"
    )


@pytest.mark.asyncio
async def test_booking_sahibi_ogrenci_okuyabilir(ip3, http):
    """Senaryo 12a — meşru erişim korunur."""
    egitmen = await ip3.tutor()
    ogrenci = await ip3.client()
    booking = await ip3.booking(egitmen, ogrenci, status=BookingStatus.COMPLETED)
    review = await ip3.review(booking)

    r = await http.get(f"{KOK}/booking/{booking.id}", headers=yetki_basligi(ogrenci))

    assert r.status_code == 200, f"ders sahibi öğrenci okuyamadı: {r.text[:200]}"
    assert r.json()["id"] == review.id


@pytest.mark.asyncio
async def test_dersin_egitmeni_okuyabilir(ip3, http):
    """Senaryo 12b — dersin eğitmeni de taraftır."""
    egitmen = await ip3.tutor()
    ogrenci = await ip3.client()
    booking = await ip3.booking(egitmen, ogrenci, status=BookingStatus.COMPLETED)
    await ip3.review(booking)

    r = await http.get(f"{KOK}/booking/{booking.id}", headers=yetki_basligi(egitmen))

    assert r.status_code == 200, f"dersin eğitmeni okuyamadı: {r.text[:200]}"


@pytest.mark.asyncio
async def test_yabanci_booking_varlik_sizdirmaz(ip3, http):
    """Senaryo 15 — "bu id'de ders var mı / değerlendirilmiş mi" cevaplanamamalı."""
    egitmen = await ip3.tutor()
    ogrenci = await ip3.client()
    yabanci = await ip3.client()
    yorumlu = await ip3.booking(egitmen, ogrenci, status=BookingStatus.COMPLETED)
    await ip3.review(yorumlu)
    yorumsuz = await ip3.booking(egitmen, ogrenci, status=BookingStatus.COMPLETED)

    a = await http.get(f"{KOK}/booking/{yorumlu.id}", headers=yetki_basligi(yabanci))
    b = await http.get(f"{KOK}/booking/{yorumsuz.id}", headers=yetki_basligi(yabanci))
    c = await http.get(f"{KOK}/booking/2000000000", headers=yetki_basligi(yabanci))

    assert a.status_code == b.status_code == c.status_code, (
        "yorumlu / yorumsuz / hiç olmayan booking farklı yanıt veriyor → "
        f"varlık sızıyor ({a.status_code}, {b.status_code}, {c.status_code})"
    )
    assert str(ogrenci.id) not in a.text, "yanıt gövdesinde öğrenci kimliği sızıyor"


@pytest.mark.asyncio
async def test_yabanci_review_patch_ve_delete_ile_ayni_sozlesme(ip3, http):
    """Üç yol drift etmemeli: GET kapanırken PATCH/DELETE de kapalı kalmalı."""
    egitmen = await ip3.tutor()
    ogrenci = await ip3.client()
    yabanci = await ip3.client()
    booking = await ip3.booking(egitmen, ogrenci, status=BookingStatus.COMPLETED)
    review = await ip3.review(booking)

    patch = await http.patch(
        f"{KOK}/{review.id}", headers=yetki_basligi(yabanci), json={"rating": 1}
    )
    delete = await http.delete(f"{KOK}/{review.id}", headers=yetki_basligi(yabanci))

    assert patch.status_code in (403, 404), f"yabancı yorum güncelledi ({patch.status_code})"
    assert delete.status_code in (403, 404), f"yabancı yorum sildi ({delete.status_code})"
