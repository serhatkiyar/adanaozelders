"""Değerlendirme: anonimlik, "Düzenlendi" kararı ve alan doğrulaması.

- Anonim değerlendirme sahibi olmayana ad, fotoğraf, client_id ve booking_id
  göndermez (`herkese_acik_yap`).
- `edited_at` yalnız genel puan, alt kriterler veya yorum metni GERÇEKTEN
  değiştiğinde güncellenir; yalnız anonimlik tercihi değişikliği saymaz.
- Dört puan da zorunludur (23 Eyl 2026): create'te eksik puan, update'te
  açık `null` reddedilir.
"""
from __future__ import annotations

import datetime

import pytest
from pydantic import ValidationError

from models.review import Review
from schemas.review import ReviewCreate, ReviewUpdate
from services.review_service import herkese_acik_yap, icerik_degisti_mi


def _review(**kw) -> Review:
    alanlar = dict(
        id=1,
        booking_id=10,
        client_id=20,
        tutor_id=30,
        rating=5,
        clarity_rating=4,
        motivation_rating=None,
        preparation_rating=None,
        comment_text="Harika",
        is_anonymous=False,
        created_at=datetime.datetime(2026, 9, 12, tzinfo=datetime.timezone.utc),
        edited_at=None,
    )
    alanlar.update(kw)
    return Review(**alanlar)


def test_anonim_yorum_sahibi_olmayana_kimlik_sizdirmaz():
    out = herkese_acik_yap(
        _review(is_anonymous=True), "Ayşe", "avatars/a.jpg", sahip_mi=False
    )
    assert out.client_name is None
    assert out.client_avatar_url is None
    assert out.client_id is None
    assert out.booking_id is None
    assert out.is_anonymous is True
    assert out.rating == 5 and out.comment_text == "Harika"


def test_anonim_yorum_sahibine_tam_doner():
    out = herkese_acik_yap(
        _review(is_anonymous=True), "Ayşe", "avatars/a.jpg", sahip_mi=True
    )
    assert out.client_name == "Ayşe"
    assert out.client_id == 20 and out.booking_id == 10


def test_anonim_olmayan_yorum_adiyla_doner():
    out = herkese_acik_yap(_review(), "Ayşe", None, sahip_mi=False)
    assert out.client_name == "Ayşe"
    assert out.client_id == 20


@pytest.mark.parametrize(
    "yeni, beklenen",
    [
        ({}, False),
        ({"rating": 5, "comment_text": "Harika"}, False),  # aynı değerler
        ({"is_anonymous": True}, False),  # yalnız anonimlik
        ({"rating": 4}, True),
        ({"clarity_rating": 4}, False),  # aynı alt kriter değeri
        ({"clarity_rating": 5}, True),
        ({"motivation_rating": 3}, True),
        ({"comment_text": "Güzel"}, True),
    ],
)
def test_icerik_degisti_mi(yeni, beklenen):
    assert icerik_degisti_mi(_review(), yeni) is beklenen


TAM = dict(rating=5, clarity_rating=4, motivation_rating=3, preparation_rating=2)
PUANLAR = ("rating", "clarity_rating", "motivation_rating", "preparation_rating")


def test_dort_puanla_create_gecerli():
    data = ReviewCreate(booking_id=1, **TAM)
    assert (data.rating, data.clarity_rating) == (5, 4)
    # Genel puan alt kriterlerden türetilmez.
    assert data.rating != round((4 + 3 + 2) / 3)


@pytest.mark.parametrize("eksik", PUANLAR)
def test_create_eksik_puan_reddedilir(eksik):
    alanlar = {k: v for k, v in TAM.items() if k != eksik}
    with pytest.raises(ValidationError):
        ReviewCreate(booking_id=1, **alanlar)
    with pytest.raises(ValidationError):
        ReviewCreate(booking_id=1, **{**TAM, eksik: None})


@pytest.mark.parametrize("alan", PUANLAR)
@pytest.mark.parametrize("puan", [0, 6])
def test_puan_araligi(alan, puan):
    with pytest.raises(ValidationError):
        ReviewCreate(booking_id=1, **{**TAM, alan: puan})
    with pytest.raises(ValidationError):
        ReviewUpdate(**{alan: puan})


@pytest.mark.parametrize("alan", (*PUANLAR, "is_anonymous"))
def test_guncellemede_null_kabul_edilmez(alan):
    with pytest.raises(ValidationError):
        ReviewUpdate(**{alan: None})


def test_bos_yorum_none():
    assert ReviewCreate(booking_id=1, **TAM, comment_text="   ").comment_text is None


def test_yorum_uzunluk_siniri():
    with pytest.raises(ValidationError):
        ReviewCreate(booking_id=1, **TAM, comment_text="a" * 2001)
