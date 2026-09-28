from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core import payments
from core.moderation import mask_contact_info
from models.booking import Booking, BookingStatus
from models.client import Client
from models.payment import Payment, PaymentStatus
from models.review import Review
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from schemas.review import (
    RatingDistributionOut,
    ReviewCreate,
    ReviewOut,
    EKSIK_PUAN_MESAJI,
    PUAN_ALANLARI,
    ReviewUpdate,
    TutorRatingSummaryOut,
)
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
        return "Bu öğretmeni zaten değerlendirdiniz."
    return None


async def egitmen_degerlendirildi_mi(
    db: AsyncSession, *, client_id: int, tutor_id: int
) -> bool:
    """Öğrencinin bu eğitmene aktif (silinmemiş) bir yorumu var mı?

    Moderasyonla gizlenmiş yorum silinmiş olsa da hakkı tüketir: aksi hâlde
    öğrenci gizlenen yorumunu silip aynı dersle yeniden yazarak moderasyon
    kararını (gizleme + puan toplamından düşme) geri alabilirdi.
    """
    return (
        await db.scalar(
            select(Review.id)
            .where(
                Review.client_id == client_id,
                Review.tutor_id == tutor_id,
                or_(Review.deleted_at.is_(None), Review.hidden_at.is_not(None)),
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
) -> ReviewOut:
    booking = await db.get(Booking, data.booking_id)
    if booking is None or booking.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    if booking.client_id != client.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "You can only review your own bookings"
        )
    # Değerlendirme (client, tutor) çiftine aittir; "zaten değerlendirdi"
    # kararı booking üzerinden değil çift üzerinden verilir.
    engel = degerlendirme_engeli(
        booking,
        booking.payment,
        saglayici=payments.get_payment_provider().name,
        egitmen_zaten_degerlendirildi=await egitmen_degerlendirildi_mi(
            db, client_id=booking.client_id, tutor_id=booking.tutor_id
        ),
    )
    if engel is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, engel)

    review = Review(
        booking_id=booking.id,
        client_id=booking.client_id,
        tutor_id=booking.tutor_id,
        rating=data.rating,
        clarity_rating=data.clarity_rating,
        motivation_rating=data.motivation_rating,
        preparation_rating=data.preparation_rating,
        # Yorumlar public profilde görünür — maskesiz kalan bir kanaldı.
        comment_text=mask_contact_info(data.comment_text),
        is_anonymous=data.is_anonymous,
    )
    try:
        # Eşzamanlı iki istek servis kontrolünü birlikte geçebilir; son söz
        # uq_reviews_client_tutor_active index'inindir.
        async with db.begin_nested():
            db.add(review)
            await db.flush()
    except IntegrityError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Bu öğretmeni zaten değerlendirdiniz."
        ) from None
    await db.execute(_adjust_tutor_rating(booking.tutor_id, 1, data.rating))
    await db.refresh(review)
    # Anonim olabilir: bildirim metni öğrenci adı içermez.
    await notification_service.notify(
        db,
        user_id=booking.tutor_id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message="Tamamlanan bir dersin için yeni bir değerlendirme aldın.",
        link="/tutor",
    )
    return herkese_acik_yap(review, client.first_name, client.avatar_url, sahip_mi=True)


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


def herkese_acik_yap(
    review: Review, ad: str | None, avatar_url: str | None, *, sahip_mi: bool
) -> ReviewOut:
    """Değerlendirmeyi yanıta çevirir — yazar görünürlüğünün TEK karar yeri.

    Yazar yalnız ADIYLA görünür (ÜK-9). Anonim değerlendirmede sahibi olmayana
    (public, öğretmen) ad, fotoğraf ve yazarı ele verebilecek `client_id` /
    `booking_id` hiç gönderilmez.
    """
    out = ReviewOut.model_validate(review)
    if review.is_anonymous and not sahip_mi:
        return out.model_copy(
            update={
                "client_id": None,
                "booking_id": None,
                "client_name": None,
                "client_avatar_url": None,
            }
        )
    return out.model_copy(update={"client_name": ad, "client_avatar_url": avatar_url})


def yazari_gorebilir_mi(user, review: Review) -> bool:
    """Anonimliğe rağmen yazarı görebilen: yalnız değerlendirmenin sahibi.
    Moderasyon admini gerçek yazarı ders ucundan (`reports.view` denetimli)
    ve admin şikayet ekranından görür."""
    return isinstance(user, Client) and review.client_id == user.id


async def _yazar(db: AsyncSession, review: Review) -> tuple[str | None, str | None]:
    row = (
        await db.execute(
            select(Client.first_name, Client.avatar_url).where(
                Client.id == review.client_id
            )
        )
    ).first()
    return (row[0], row[1]) if row else (None, None)


async def review_out(
    db: AsyncSession, review: Review, *, viewer, yetkili_admin: bool = False
) -> ReviewOut:
    ad, avatar_url = await _yazar(db, review)
    return herkese_acik_yap(
        review,
        ad,
        avatar_url,
        sahip_mi=yetkili_admin or yazari_gorebilir_mi(viewer, review),
    )


async def get_by_booking(
    db: AsyncSession, booking_id: int, *, viewer
) -> ReviewOut | None:
    """Dersin (client, tutor) çiftine ait aktif değerlendirme.

    Değerlendirme booking'e değil çifte aittir: öğrenci o öğretmenle yaptığı
    HER dersin detayında aynı değerlendirmeyi görür ve düzenler. Öğretmen
    anonim değerlendirmeyi ders üzerinden göremez — ders, yazarın kim
    olduğunu söylerdi.
    """
    booking = await db.get(Booking, booking_id)
    if booking is None or booking.deleted_at is not None:
        return None
    review = await db.scalar(
        select(Review).where(
            Review.client_id == booking.client_id,
            Review.tutor_id == booking.tutor_id,
            Review.deleted_at.is_(None),
        )
    )
    if review is None:
        return None
    from models.admin import Admin

    # Admin buraya yalnız assert_booking_review_viewer'daki reports.view
    # denetiminden geçerek ulaşır; moderasyon için gerçek yazarı görür.
    yetkili_admin = isinstance(viewer, Admin)
    if (
        review.is_anonymous
        and not yetkili_admin
        and not yazari_gorebilir_mi(viewer, review)
    ):
        return None
    return await review_out(db, review, viewer=viewer, yetkili_admin=yetkili_admin)


async def list_reviews(
    db: AsyncSession,
    *,
    tutor_id: int | None = None,
    client_id: int | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[ReviewOut]:
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
    return [
        herkese_acik_yap(review, ad, avatar_url, sahip_mi=False)
        for review, ad, avatar_url in rows
    ]


async def rating_distribution(
    db: AsyncSession, tutor_id: int
) -> TutorRatingSummaryOut:
    """Bir öğretmenin yıldız dağılımı + alt kriter ortalamaları (silinmemiş VE
    gizlenmemiş yorumlar). AVG NULL'ları saymaz: alt kriter ortalaması yalnız
    o kritere puan verilmiş değerlendirmelerden çıkar."""
    canli = (
        Review.tutor_id == tutor_id,
        Review.deleted_at.is_(None),
        Review.hidden_at.is_(None),
    )
    rows = (
        await db.execute(
            select(Review.rating, func.count()).where(*canli).group_by(Review.rating)
        )
    ).all()
    netlik, motivasyon, hazirlik = (
        await db.execute(
            select(
                func.avg(Review.clarity_rating),
                func.avg(Review.motivation_rating),
                func.avg(Review.preparation_rating),
            ).where(*canli)
        )
    ).one()

    def _f(v) -> float | None:
        return float(v) if v is not None else None

    return TutorRatingSummaryOut(
        **_build_distribution(rows).model_dump(),
        clarity_average=_f(netlik),
        motivation_average=_f(motivasyon),
        preparation_average=_f(hazirlik),
    )


# Değişince "Düzenlendi" etiketini tetikleyen alanlar. is_anonymous bilerek
# yok: yalnız görünürlük tercihini değiştirmek içerik düzenlemesi sayılmaz.
ICERIK_ALANLARI = (
    "rating",
    "clarity_rating",
    "motivation_rating",
    "preparation_rating",
    "comment_text",
)


def icerik_degisti_mi(review: Review, yeni: dict) -> bool:
    """`yeni` (maskelenmiş, exclude_unset payload) içerik alanlarından birini
    gerçekten değiştiriyor mu? Aynı değeri tekrar göndermek düzenleme değildir."""
    return any(
        alan in yeni and yeni[alan] != getattr(review, alan)
        for alan in ICERIK_ALANLARI
    )


async def update_review(
    db: AsyncSession, review: Review, data: ReviewUpdate, *, viewer
) -> ReviewOut:
    payload = data.model_dump(exclude_unset=True)
    # Legacy kayıtta NULL kalmış kriter varsa, hangi alan değişirse değişsin
    # dört puan tamamlanmadan kayıt güncellenmez.
    if payload and any(
        payload.get(alan, getattr(review, alan)) is None for alan in PUAN_ALANLARI
    ):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, EKSIK_PUAN_MESAJI)
    if "comment_text" in payload:
        payload["comment_text"] = mask_contact_info(payload["comment_text"])
    if icerik_degisti_mi(review, payload):
        review.edited_at = datetime.datetime.now(datetime.timezone.utc)
    new_rating = payload.pop("rating", None)
    if new_rating is not None and new_rating != review.rating:
        # Gizlenmiş yorum puan toplamından zaten düşülmüştür; farkı uygulamak
        # toplamı bozar (unhide o anki rating'i geri ekler).
        if not review.is_hidden:
            await db.execute(
                _adjust_tutor_rating(review.tutor_id, 0, new_rating - review.rating)
            )
        review.rating = new_rating
    for alan, deger in payload.items():
        setattr(review, alan, deger)
    await db.flush()
    await db.refresh(review)
    return await review_out(db, review, viewer=viewer)


async def delete_review(db: AsyncSession, review: Review) -> None:
    # Gizlenmiş yorum toplamdan zaten düşülmüştür; ikinci kez düşülmez.
    if not review.is_hidden:
        await db.execute(_adjust_tutor_rating(review.tutor_id, -1, -review.rating))
    review.deleted_at = datetime.datetime.now(datetime.timezone.utc)
    await db.flush()
