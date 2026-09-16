from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core import payments
from core.moderation import mask_contact_info
from models.booking import Booking, BookingStatus
from models.client import Client
from models.payment import Payment, PaymentStatus
from models.review import Review
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from schemas.review import RatingDistributionOut, ReviewCreate, ReviewUpdate
from services import notification_service


def _build_distribution(rows: list[tuple[int, int]]) -> RatingDistributionOut:
    """`(rating, count)` satırlarından 1..5 dağılımı + ortalama üretir."""
    counts = {star: 0 for star in range(1, 6)}
    total = 0
    weighted = 0
    for rating, count in rows:
        r, c = int(rating), int(count)
        counts[r] = c
        total += c
        weighted += r * c
    average = (weighted / total) if total else None
    return RatingDistributionOut(count=total, average=average, distribution=counts)


def _adjust_tutor_rating(tutor_id: int, count_delta: int, sum_delta: int):
    return (
        update(Tutor)
        .where(Tutor.id == tutor_id)
        .values(
            rating_count=Tutor.rating_count + count_delta,
            rating_sum=Tutor.rating_sum + sum_delta,
        )
    )


# ── Değerlendirme uygunluğu ───────────────────────────────────────────────
#
# Kullanıcı kararı (16 Eyl 2026):
#   1. Bir öğrenci bir eğitmeni YALNIZ BİR KEZ değerlendirir. Eskiden kural
#      "booking başına bir yorum"du; aynı eğitmenden üç ders alan öğrenci üç
#      yorum yazabiliyordu (canlı veride görüldü: bir öğrenci-eğitmen çiftinde
#      3 aktif yorum).
#   2. Yalnız KARTLA (iyzico ile) ÖDENMİŞ ders değerlendirilebilir. Ücretsiz
#      ilk ders ya da ödemesi tamamlanmamış ders yorum hakkı vermez.
#
# Sağlayıcı adı sabit "iyzico" DEĞİL, yapılandırılmış sağlayıcıdır: üretimde
# `core/config.py` PAYMENT_PROVIDER=iyzico'yu zorlar; geliştirmede "fake"
# sağlayıcı aynı akışı taklit eder ve kural yerelde de denenebilir kalır.
#
# Karar SAF bir fonksiyonda (`degerlendirme_engeli`) verilir: hem yorum
# oluşturma hem rezervasyon çıktısındaki `can_review` bayrağı aynı fonksiyonu
# çağırır, ikisi ayrışamaz; fonksiyon veritabanısız test edilir.

ODENMIS_DURUMLAR = frozenset({PaymentStatus.HELD, PaymentStatus.RELEASED})


def degerlendirme_engeli(
    booking: Booking,
    payment: Payment | None,
    *,
    saglayici: str,
    egitmen_zaten_degerlendirildi: bool,
    booking_zaten_degerlendirildi: bool = False,
) -> str | None:
    """Değerlendirme yapılamıyorsa kullanıcıya gösterilecek gerekçe, yoksa None."""
    if booking.status != BookingStatus.COMPLETED:
        return "Yalnız tamamlanmış dersler değerlendirilebilir."
    if (
        payment is None
        or payment.deleted_at is not None
        or payment.status not in ODENMIS_DURUMLAR
        or payment.provider != saglayici
    ):
        return "Yalnız kartla ödenmiş dersler değerlendirilebilir."
    if booking_zaten_degerlendirildi:
        return "Bu ders zaten değerlendirilmiş."
    if egitmen_zaten_degerlendirildi:
        return "Bu eğitmeni zaten değerlendirdiniz."
    return None


async def egitmen_degerlendirildi_mi(
    db: AsyncSession, *, client_id: int, tutor_id: int
) -> bool:
    """Öğrencinin bu eğitmene aktif (silinmemiş) bir yorumu var mı?"""
    return (
        await db.scalar(
            select(Review.id)
            .where(
                Review.client_id == client_id,
                Review.tutor_id == tutor_id,
                Review.deleted_at.is_(None),
            )
            .limit(1)
        )
    ) is not None


async def degerlendirilebilir_mi(db: AsyncSession, booking: Booking) -> bool:
    """Rezervasyon çıktısındaki `can_review` bayrağı — `create_review` ile aynı kural."""
    if booking.status != BookingStatus.COMPLETED:
        return False
    engel = degerlendirme_engeli(
        booking,
        booking.payment,
        saglayici=payments.get_payment_provider().name,
        egitmen_zaten_degerlendirildi=await egitmen_degerlendirildi_mi(
            db, client_id=booking.client_id, tutor_id=booking.tutor_id
        ),
    )
    return engel is None


async def create_review(
    db: AsyncSession, client: Client, data: ReviewCreate
) -> Review:
    booking = await db.get(Booking, data.booking_id)
    if booking is None or booking.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    if booking.client_id != client.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "You can only review your own bookings"
        )
    booking_degerlendirildi = (
        await db.scalar(
            select(Review.id).where(
                Review.booking_id == data.booking_id, Review.deleted_at.is_(None)
            )
        )
    ) is not None
    engel = degerlendirme_engeli(
        booking,
        booking.payment,
        saglayici=payments.get_payment_provider().name,
        egitmen_zaten_degerlendirildi=await egitmen_degerlendirildi_mi(
            db, client_id=booking.client_id, tutor_id=booking.tutor_id
        ),
        booking_zaten_degerlendirildi=booking_degerlendirildi,
    )
    if engel is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, engel)

    review = Review(
        booking_id=booking.id,
        client_id=booking.client_id,
        tutor_id=booking.tutor_id,
        rating=data.rating,
        # Yorumlar public profilde görünür — maskesiz kalan bir kanaldı.
        comment_text=mask_contact_info(data.comment_text),
    )
    db.add(review)
    await db.flush()
    await db.execute(_adjust_tutor_rating(booking.tutor_id, 1, data.rating))
    await db.refresh(review)
    await notification_service.notify(
        db,
        user_id=booking.tutor_id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message="Tamamlanan bir dersin için yeni bir değerlendirme aldın.",
        link="/tutor",
    )
    return review


async def add_reply(db: AsyncSession, review: Review, reply: str) -> Review:
    review.tutor_reply = reply
    await db.flush()
    await notification_service.notify(
        db,
        user_id=review.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message="Eğitmen değerlendirmene yanıt verdi.",
        link="/student/bookings",
    )
    return review


async def get_review(db: AsyncSession, review_id: int) -> Review | None:
    review = await db.get(Review, review_id)
    if review is None or review.deleted_at is not None:
        return None
    return review


async def assert_booking_review_viewer(
    db: AsyncSession, user, booking_id: int
) -> None:
    """`GET /reviews/booking/{id}` sahiplik kararı — TEK ortak yer (İP-3 §5.3).

    Yalnız o dersin öğrencisi, eğitmeni ya da moderasyon izinli (`reports.view`)
    admin okuyabilir. Yabancı kullanıcı için yorumlu / yorumsuz / hiç olmayan
    booking **aynı 404**'ü alır — "bu id'de ders var mı ve değerlendirilmiş mi"
    sorusu ardışık id taramasıyla cevaplanamaz (İP-3 §5.2).

    Rol modeli ayrı tablolarda yaşadığı için karşılaştırma `isinstance` + id
    birlikte yapılır (çıplak id karşılaştırması tablolar arasında çakışır).
    """
    from models.admin import Admin

    booking = await db.get(Booking, booking_id)
    booking_ok = booking is not None and booking.deleted_at is None
    if booking_ok and isinstance(user, Client) and booking.client_id == user.id:
        return
    if booking_ok and isinstance(user, Tutor) and booking.tutor_id == user.id:
        return
    if booking_ok and isinstance(user, Admin):
        from services import admin_access_service

        _role, perms = await admin_access_service.get_admin_access(db, user.id)
        if "reports.view" in perms:
            return
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Ders bulunamadı")


async def get_by_booking(db: AsyncSession, booking_id: int) -> Review | None:
    row = (
        await db.execute(
            select(Review, Client.first_name, Client.avatar_url)
            .join(Client, Review.client_id == Client.id)
            .where(Review.booking_id == booking_id, Review.deleted_at.is_(None))
        )
    ).first()
    if row is None:
        return None
    review, ad, avatar_url = row
    # Yorum yazarı yalnız ADIYLA görünür (ÜK-9): bu uç auth'suz, yani
    # öğrencinin tam adı giriş yapmamış herkese açık olurdu.
    review.client_name = ad
    review.client_avatar_url = avatar_url
    return review


async def list_reviews(
    db: AsyncSession,
    *,
    tutor_id: int | None = None,
    client_id: int | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[Review]:
    stmt = (
        select(Review, Client.first_name, Client.avatar_url)
        .join(Client, Review.client_id == Client.id)
        # Moderasyonla gizlenen yorum public listede görünmez (bkz.
        # services/content_moderation.py); puan toplamından da düşülmüştür.
        .where(Review.deleted_at.is_(None), Review.hidden_at.is_(None))
    )
    if tutor_id is not None:
        stmt = stmt.where(Review.tutor_id == tutor_id)
    if client_id is not None:
        stmt = stmt.where(Review.client_id == client_id)
    stmt = stmt.order_by(Review.created_at.desc()).limit(limit).offset(offset)
    rows = (await db.execute(stmt)).all()
    reviews: list[Review] = []
    for review, ad, avatar_url in rows:
        # Yalnız ad (ÜK-9) — transient alan, serileştirme için.
        review.client_name = ad
        review.client_avatar_url = avatar_url
        reviews.append(review)
    return reviews


async def rating_distribution(
    db: AsyncSession, tutor_id: int
) -> RatingDistributionOut:
    """Bir eğitmenin yıldız dağılımı (silinmemiş VE gizlenmemiş yorumlar)."""
    rows = (
        await db.execute(
            select(Review.rating, func.count())
            .where(
                Review.tutor_id == tutor_id,
                Review.deleted_at.is_(None),
                Review.hidden_at.is_(None),
            )
            .group_by(Review.rating)
        )
    ).all()
    return _build_distribution(rows)


async def update_review(
    db: AsyncSession, review: Review, data: ReviewUpdate
) -> Review:
    payload = data.model_dump(exclude_unset=True)
    new_rating = payload.get("rating")
    if new_rating is not None and new_rating != review.rating:
        await db.execute(
            _adjust_tutor_rating(review.tutor_id, 0, new_rating - review.rating)
        )
        review.rating = new_rating
    if "comment_text" in payload:
        review.comment_text = mask_contact_info(payload["comment_text"])
    await db.flush()
    return review


async def delete_review(db: AsyncSession, review: Review) -> None:
    await db.execute(_adjust_tutor_rating(review.tutor_id, -1, -review.rating))
    review.deleted_at = datetime.datetime.now(datetime.timezone.utc)
    await db.flush()
