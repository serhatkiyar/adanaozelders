"""Yorum moderasyonu — gerçek servis + gerçek DB.

Kritik davranış: gizlenen yorum yalnız EKRANDAN kalkmaz, PUAN ORTALAMASINDAN
da düşer. Aksi halde hakaret içeren 1 yıldızlı bir yorum yayından kaldırılır
ama eğitmenin puanını düşürmeye devam ederdi — moderasyon yarım kalırdı.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from services import content_moderation


class FakeAdmin:
    id = 1


async def _make_review(db, factory, *, rating: int = 1):
    """Tamamlanmış ders + o derse yazılmış yorum üretir."""
    import datetime
    from decimal import Decimal

    from models.booking import Booking, BookingStatus
    from models.review import Review

    tutor = await factory.tutor(db)
    client = await factory.client(db)
    start = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=3)
    booking = Booking(
        tutor_id=tutor.id,
        client_id=client.id,
        status=BookingStatus.COMPLETED,
        start_at=start,
        end_at=start + datetime.timedelta(hours=1),
        price=Decimal("500"),
    )
    db.add(booking)
    await db.flush()

    review = Review(
        booking_id=booking.id,
        client_id=client.id,
        tutor_id=tutor.id,
        rating=rating,
        comment_text="Uygunsuz içerik",
    )
    db.add(review)
    tutor.rating_count += 1
    tutor.rating_sum += rating
    await db.commit()
    return tutor, review


async def test_gizlenen_yorum_puandan_dusulur(db, factory):
    tutor, review = await _make_review(db, factory, rating=1)
    before_count, before_sum = tutor.rating_count, tutor.rating_sum

    await content_moderation.hide(
        db,
        target_type="REVIEW",
        target_id=review.id,
        admin=FakeAdmin(),
        reason="Hakaret",
    )
    await db.commit()
    await db.refresh(tutor)

    assert review.hidden_at is not None
    assert review.hidden_reason == "Hakaret"
    assert tutor.rating_count == before_count - 1
    assert tutor.rating_sum == before_sum - 1


async def test_gizleme_geri_alinabilir(db, factory):
    tutor, review = await _make_review(db, factory, rating=5)
    before_count, before_sum = tutor.rating_count, tutor.rating_sum

    await content_moderation.hide(
        db, target_type="REVIEW", target_id=review.id, admin=FakeAdmin()
    )
    await content_moderation.unhide(db, target_type="REVIEW", target_id=review.id)
    await db.commit()
    await db.refresh(tutor)

    assert review.hidden_at is None
    assert tutor.rating_count == before_count
    assert tutor.rating_sum == before_sum


async def test_iki_kez_gizlemek_puani_iki_kez_dusurmez(db, factory):
    """İdempotenlik: aynı şikayet iki admin tarafından kapatılabilir."""
    tutor, review = await _make_review(db, factory, rating=4)
    before_count = tutor.rating_count

    await content_moderation.hide(
        db, target_type="REVIEW", target_id=review.id, admin=FakeAdmin()
    )
    await content_moderation.hide(
        db, target_type="REVIEW", target_id=review.id, admin=FakeAdmin()
    )
    await db.commit()
    await db.refresh(tutor)

    assert tutor.rating_count == before_count - 1


async def test_gizli_yorum_public_listede_yok(db, factory):
    from services import review_service

    tutor, review = await _make_review(db, factory, rating=2)

    visible = await review_service.list_reviews(db, tutor_id=tutor.id)
    assert any(r.id == review.id for r in visible)

    await content_moderation.hide(
        db, target_type="REVIEW", target_id=review.id, admin=FakeAdmin()
    )
    await db.commit()

    visible = await review_service.list_reviews(db, tutor_id=tutor.id)
    assert all(r.id != review.id for r in visible)

    dist = await review_service.rating_distribution(db, tutor.id)
    assert dist.count == 0, "gizlenen yorum yıldız dağılımında sayılmamalı"


async def test_desteklenmeyen_tur_reddedilir(db):
    """Kullanıcı/mesaj gibi hedefler bu uçtan gizlenemez — sessizce
    başarılı dönmek, adminde "kaldırdım" yanılsaması yaratırdı."""
    with pytest.raises(HTTPException) as exc:
        await content_moderation.hide(
            db, target_type="TUTOR", target_id=1, admin=FakeAdmin()
        )
    assert exc.value.status_code == 400
