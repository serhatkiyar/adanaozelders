"""Öğrenci panosu özeti (Modül 4).

Öğrencinin `/pano` sayfası tek bir "sıradaki eylem" kartı, kısa bir "sıradaki
dersler" listesi ve acil şerit sayıları gösterir. İstemci eskiden
`GET /bookings?limit=100` ile sayıyordu; sayılar ve öncelik burada, sunucuda
hesaplanır. Pano yalnız DERSLERİ kapsar; kütüphane/deneme rezervasyonları
Rezervasyonlar listesinde kalır.

Salt okunur: hiçbir durum değiştirmez, para hesabı yapmaz (tutar dersin kendi
alanından okunur, ödeme ucu yine sunucuda hesaplar).
"""
from __future__ import annotations

import datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.booking import Booking, BookingStatus
from models.client import Client
from models.payment import Payment, PaymentStatus
from models.review import Review
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor, TutorStatus
from services import booking_service

UPCOMING_LIMIT = 3
JOIN_OPENS_BEFORE = datetime.timedelta(minutes=15)
REVIEW_WINDOW_DAYS = 30
REVIEW_SCAN_LIMIT = 20

# İlk eşleşen kazanır: önce zaman kritik olan (katılma), sonra karşı tarafı
# bekleten yanıt (teklif), dersi kesinleştiren ödeme, süreli para kararı
# (onay penceresi), itibar (değerlendirme), en son bilgi kartları.
NEXT_ACTION_PRIORITY = (
    "JOIN_LESSON",
    "RESPOND_OFFER",
    "PAY",
    "CONFIRM_LESSON",
    "REVIEW",
    "NEXT_LESSON",
    "BOOK_AGAIN",
)


def pick_next_action(
    adaylar: dict[str, Booking | None],
) -> tuple[str, Booking] | None:
    """Öncelik sırasında ilk dolu adayı döndürür; hiçbiri yoksa ``None``."""
    for kind in NEXT_ACTION_PRIORITY:
        booking = adaylar.get(kind)
        if booking is not None:
            return kind, booking
    return None


def _odeme_durumu(*durumlar: PaymentStatus):
    """Silinmemiş ödemesi verilen durumlardan birinde olan ders."""
    return Booking.payment.has(
        and_(Payment.deleted_at.is_(None), Payment.status.in_(durumlar))
    )


def _odeme_yok():
    """Silinmemiş ödeme kaydı olmayan ders (ücretsiz ilk ders: price=0)."""
    return ~Booking.payment.has(Payment.deleted_at.is_(None))


async def build_dashboard(
    db: AsyncSession, client: Client, *, now: datetime.datetime
) -> dict:
    client_role = ROLE_IDS[RoleType.CLIENT]
    own = (Booking.client_id == client.id, Booking.deleted_at.is_(None))

    async def _count(*conds) -> int:
        stmt = select(func.count()).select_from(Booking).where(*own, *conds)
        return int((await db.execute(stmt)).scalar_one())

    async def _rows(*conds, order_by, limit: int) -> list[Booking]:
        stmt = (
            booking_service._hydrated_booking_select()
            .where(Booking.client_id == client.id, *conds)
            .order_by(order_by)
            .limit(limit)
        )
        rows = (await db.execute(stmt)).all()
        return await booking_service._hydrate_booking_rows(
            db, rows, role_id=client_role, user_id=client.id
        )

    async def _first(*conds, order_by) -> Booking | None:
        rows = await _rows(*conds, order_by=order_by, limit=1)
        return rows[0] if rows else None

    # Ödenmiş ya da ücretsiz: derse katılmaya engel yok.
    odendi_ya_da_ucretsiz = or_(
        _odeme_yok(), _odeme_durumu(PaymentStatus.HELD, PaymentStatus.RELEASED)
    )

    join_conds = (
        Booking.status == BookingStatus.ACCEPTED,
        Booking.start_at - JOIN_OPENS_BEFORE <= now,
        Booking.end_at > now,
        odendi_ya_da_ucretsiz,
    )
    offer_conds = (
        Booking.status == BookingStatus.PENDING,
        Booking.offered_by_tutor.is_(True),
        Booking.start_at > now,
    )
    pay_conds = (
        Booking.status == BookingStatus.ACCEPTED,
        Booking.end_at > now,
        _odeme_durumu(PaymentStatus.PENDING, PaymentStatus.FAILED),
    )
    # Onay penceresindeki biten ders: onaylanmamış, itiraz açılmamış, ücreti
    # emanette (ya da ücretsiz). RELEASED zaten eğitmene geçmiştir.
    confirm_conds = (
        Booking.status.in_((BookingStatus.ACCEPTED, BookingStatus.COMPLETED)),
        Booking.end_at <= now,
        Booking.end_at
        > now - datetime.timedelta(hours=settings.LESSON_CONFIRM_WINDOW_HOURS),
        Booking.student_confirmed_at.is_(None),
        Booking.is_disputed.is_(False),
        or_(_odeme_yok(), _odeme_durumu(PaymentStatus.HELD)),
    )

    join = await _first(*join_conds, order_by=Booking.start_at.asc())
    offer = await _first(*offer_conds, order_by=Booking.start_at.asc())
    pay = await _first(*pay_conds, order_by=Booking.start_at.asc())
    confirm = await _first(*confirm_conds, order_by=Booking.end_at.asc())

    # Değerlendirme: kural eğitmen başına tek yorum, o yüzden satır satır
    # `can_review` (hydrate hesaplar) okunur; tarama bilinçli olarak sınırlı.
    review_scan = await _rows(
        Booking.status == BookingStatus.COMPLETED,
        Booking.end_at >= now - datetime.timedelta(days=REVIEW_WINDOW_DAYS),
        ~Booking.review.has(Review.deleted_at.is_(None)),
        order_by=Booking.end_at.desc(),
        limit=REVIEW_SCAN_LIMIT,
    )
    reviewable = [b for b in review_scan if getattr(b, "can_review", False)]
    review = reviewable[0] if reviewable else None
    review_count = len({b.tutor_id for b in reviewable})

    # JOIN'e girmeyen (henüz açılmamış ya da ödenmemiş) en yakın kabul edilmiş ders.
    next_conds: list = [
        Booking.status == BookingStatus.ACCEPTED,
        Booking.end_at > now,
    ]
    if join is not None:
        next_conds.append(Booking.id != join.id)
    next_lesson = await _first(*next_conds, order_by=Booking.start_at.asc())

    book_again = await _first(
        Booking.status == BookingStatus.COMPLETED,
        Tutor.status == TutorStatus.APPROVED,
        Tutor.is_active.is_(True),
        Tutor.deleted_at.is_(None),
        order_by=Booking.end_at.desc(),
    )

    picked = pick_next_action(
        {
            "JOIN_LESSON": join,
            "RESPOND_OFFER": offer,
            "PAY": pay,
            "CONFIRM_LESSON": confirm,
            "REVIEW": review,
            "NEXT_LESSON": next_lesson,
            "BOOK_AGAIN": book_again,
        }
    )
    next_action = (
        {"kind": picked[0], "booking": picked[1]} if picked is not None else None
    )

    upcoming_conds: list = [
        or_(
            and_(
                Booking.status == BookingStatus.PENDING, Booking.start_at > now
            ),
            and_(
                Booking.status == BookingStatus.ACCEPTED, Booking.end_at > now
            ),
        )
    ]
    if picked is not None:
        upcoming_conds.append(Booking.id != picked[1].id)
    upcoming = await _rows(
        *upcoming_conds, order_by=Booking.start_at.asc(), limit=UPCOMING_LIMIT
    )
    upcoming_count = await _count(*upcoming_conds)

    offer_count = await _count(*offer_conds)
    payment_due_count = await _count(*pay_conds)
    confirm_count = await _count(*confirm_conds)
    completed_total = await _count(Booking.status == BookingStatus.COMPLETED)
    has_bookings = await _count() > 0

    # Boş hesaba keşif kartı: yayında (search_service ile aynı filtre) ve ilk
    # dersi ücretsiz eğitmen sayısı. Ders geçmişi olana gerekmez.
    free_first_lesson_tutor_count = 0
    if not has_bookings:
        free_first_lesson_tutor_count = 0

    return {
        "next_action": next_action,
        "upcoming": upcoming,
        "upcoming_count": upcoming_count,
        "offer_count": offer_count,
        "payment_due_count": payment_due_count,
        "confirm_count": confirm_count,
        "review_count": review_count,
        "completed_total": completed_total,
        "has_bookings": has_bookings,
        "free_first_lesson_tutor_count": free_first_lesson_tutor_count,
    }
