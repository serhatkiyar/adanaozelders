"""Eğitmen analizleri: genel bakış ve başarı hedefleri (Modül 7).

`tutor_dashboard_service` deseninde salt okunur; hiçbir durum değiştirmez.
Her sorgu yalnız ``tutor_id == tutor.id`` satırlarına bakar.

Pencereler: seçili dönem `[now−N, now)`, önceki dönem `[now−2N, now−N)`.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

from sqlalchemy import and_, func, literal_column, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.booking import Booking, BookingStatus
from models.messaging import Conversation, Message
from models.payment import Payment, PaymentStatus
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from services.tutor_dashboard_service import TZ

PERIODS: dict[str, int] = {"week": 7, "month": 30, "quarter": 90}

#: `bookings.cancelled_by_role` bu andan itibaren yazılıyor (m7_izin_analiz).
#: Öncesindeki eğitmen iptalleri ayırt edilemez; pencere buradan önce başlarsa
#: iptal oranı "veri yetersiz" sayılır.
M7_CANCEL_TRACKING_SINCE = datetime.datetime(2026, 9, 17, 0, 0, tzinfo=TZ)

CANCEL_RATE_TARGET = 0.05
CANCEL_RATE_MIN_SAMPLE = 5
RESPONSE_TARGET = 0.9
RESPONSE_MIN_SAMPLE = 3
RESPONSE_WINDOW = datetime.timedelta(hours=24)
# SQL tarafı: asyncpg timedelta parametresini sütun aritmetiğinde yanlış
# çıkarsayabiliyor; aralık sabit olarak yazılır.
_RESPONSE_WINDOW_SQL = literal_column("interval '24 hours'")
RATING_TARGET = 4.8
RATING_MIN_SAMPLE = 3


# ── Saf yardımcılar ──────────────────────────────────────────────────────────


def windows(
    now: datetime.datetime, days: int
) -> tuple[tuple[datetime.datetime, datetime.datetime], tuple[datetime.datetime, datetime.datetime]]:
    """Bitişik iki eşit pencere: (seçili, önceki)."""
    span = datetime.timedelta(days=days)
    return (now - span, now), (now - 2 * span, now - span)


def trend_pct(cur: float, prev: float) -> int | None:
    if not prev:
        return None
    return round((cur - prev) / prev * 100)


def rate(num: int, den: int, min_den: int) -> float | None:
    if den < min_den or den == 0:
        return None
    return num / den


def _trend(cur, prev) -> dict:
    return {"value": cur, "previous": prev, "trend_pct": trend_pct(cur, prev)}


def _in(col, window) -> object:
    start, end = window
    return and_(col >= start, col < end)


def _tl(v) -> float:
    return float(Decimal(str(v)).quantize(Decimal("0.01")))


def series_buckets(
    now: datetime.datetime, period: str
) -> list[tuple[datetime.datetime, datetime.datetime]]:
    """Seçili dönemi (`windows()` ile aynı `cur` aralığını) kova sınırlarına böler.

    week/month → günlük kovalar, quarter → haftalık kovalar. Kalan gün varsa
    (90 // 7 = 12 kalan 6) en eski kovaya eklenir; böylece kovaların toplamı
    `windows(now, days)[0]` ile birebir örtüşür.
    """
    days = PERIODS[period]
    step_days = 7 if period == "quarter" else 1
    full, remainder = divmod(days, step_days)

    buckets: list[tuple[datetime.datetime, datetime.datetime]] = []
    end = now
    for _ in range(full):
        start = end - datetime.timedelta(days=step_days)
        buckets.append((start, end))
        end = start
    if remainder:
        start = end - datetime.timedelta(days=remainder)
        buckets.append((start, end))
        end = start
    buckets.reverse()
    return buckets


# ── Genel bakış ──────────────────────────────────────────────────────────────


async def build_overview(
    db: AsyncSession, tutor: Tutor, *, period: str, now: datetime.datetime
) -> dict:
    cur, prev = windows(now, PERIODS[period])

    # Kazanç: `payment_service.earnings_summary`'deki ders kazancı filtresi.
    earning_stmt = (
        select(
            func.coalesce(
                func.sum(Payment.tutor_earning).filter(_in(Payment.released_at, cur)), 0
            ),
            func.coalesce(
                func.sum(Payment.tutor_earning).filter(_in(Payment.released_at, prev)), 0
            ),
        )
        .select_from(Payment)
        .join(Booking, Booking.id == Payment.booking_id)
        .where(
            Booking.tutor_id == tutor.id,
            Payment.deleted_at.is_(None),
            Payment.status == PaymentStatus.RELEASED,
        )
    )
    earn_cur, earn_prev = (await db.execute(earning_stmt)).one()

    completed = (
        Booking.tutor_id == tutor.id,
        Booking.deleted_at.is_(None),
        Booking.status == BookingStatus.COMPLETED,
    )
    lesson_stmt = select(
        func.count().filter(_in(Booking.end_at, cur)),
        func.count().filter(_in(Booking.end_at, prev)),
        func.count(func.distinct(Booking.client_id)).filter(_in(Booking.end_at, cur)),
        func.count(func.distinct(Booking.client_id)).filter(_in(Booking.end_at, prev)),
    ).where(*completed)
    lessons_cur, lessons_prev, active_cur, active_prev = (
        await db.execute(lesson_stmt)
    ).one()

    first_lesson = (
        select(Booking.client_id, func.min(Booking.end_at).label("first_end"))
        .where(*completed)
        .group_by(Booking.client_id)
        .subquery()
    )
    new_stmt = select(
        func.count().filter(_in(first_lesson.c.first_end, cur)),
        func.count().filter(_in(first_lesson.c.first_end, prev)),
    ).select_from(first_lesson)
    new_cur, new_prev = (await db.execute(new_stmt)).one()

    return {
        "period": period,
        "current_start": cur[0],
        "current_end": cur[1],
        "previous_start": prev[0],
        "previous_end": prev[1],
        "earnings": _trend(_tl(earn_cur), _tl(earn_prev)),
        "lessons": _trend(int(lessons_cur), int(lessons_prev)),
        "active_students": _trend(int(active_cur), int(active_prev)),
        "new_students": _trend(int(new_cur), int(new_prev)),
    }


# ── Başarı hedefleri ─────────────────────────────────────────────────────────


def _goal(code: str, value, target: float, comparator: str, sample: int, live=False) -> dict:
    if value is None:
        achieved = None
    elif comparator == "lte":
        achieved = value <= target
    elif comparator == "gte":
        achieved = value >= target
    else:
        achieved = value == target
    return {
        "code": code,
        "value": value,
        "target": target,
        "comparator": comparator,
        "achieved": achieved,
        "sample": sample,
        "live": live,
    }


async def _cancel_rate(db: AsyncSession, tutor: Tutor, window) -> dict:
    """Eğitmen iptalleri / (tamamlanan + eğitmen iptalleri), `start_at` penceresinde."""
    tutor_cancel = and_(
        Booking.status == BookingStatus.CANCELLED,
        Booking.cancelled_by_role == ROLE_IDS[RoleType.TUTOR],
    )
    stmt = select(
        func.count().filter(tutor_cancel),
        func.count().filter(Booking.status == BookingStatus.COMPLETED),
    ).where(
        Booking.tutor_id == tutor.id,
        Booking.deleted_at.is_(None),
        _in(Booking.start_at, window),
    )
    cancels, completed = (await db.execute(stmt)).one()
    den = int(cancels) + int(completed)
    value = None
    if window[0] >= M7_CANCEL_TRACKING_SINCE:
        value = rate(int(cancels), den, CANCEL_RATE_MIN_SAMPLE)
    return _goal("CANCEL_RATE", value, CANCEL_RATE_TARGET, "lte", den)


async def _missed_lessons(db: AsyncSession, tutor: Tutor, window) -> dict:
    """Öğrencinin "eğitmen gelmedi" bildirimi admin iade kararıyla sonuçlanan dersler."""
    missed = and_(
        Booking.status == BookingStatus.CANCELLED,
        Booking.issue_reason == "TUTOR_ABSENT",
        Booking.cancelled_by_role == ROLE_IDS[RoleType.ADMIN],
    )
    held = Booking.status.in_([BookingStatus.ACCEPTED, BookingStatus.COMPLETED])
    stmt = select(
        func.count().filter(missed),
        func.count().filter(held | missed),
    ).where(
        Booking.tutor_id == tutor.id,
        Booking.deleted_at.is_(None),
        _in(Booking.start_at, window),
    )
    missed_n, sample = (await db.execute(stmt)).one()
    value = int(missed_n) if int(sample) > 0 else None
    return _goal("MISSED_LESSONS", value, 0, "eq", int(sample))


async def _response_24h(
    db: AsyncSession, tutor: Tutor, window, now: datetime.datetime
) -> dict:
    """Öğrencinin başlattığı sohbetlerde ilk metin mesajına 24 saatte eğitmen yanıtı."""
    first_client = (
        select(
            Message.conversation_id.label("cid"),
            func.min(Message.created_at).label("first_at"),
        )
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            Conversation.tutor_id == tutor.id,
            Conversation.client_id.is_not(None),
            Conversation.library_id.is_(None),
            Message.sender_role == "CLIENT",
            Message.msg_type == "text",
        )
        .group_by(Message.conversation_id)
        .subquery()
    )
    tutor_msg = Message.__table__.alias("tutor_msg")
    tutor_before = (
        select(tutor_msg.c.id)
        .where(
            tutor_msg.c.conversation_id == first_client.c.cid,
            tutor_msg.c.sender_role == "TUTOR",
            tutor_msg.c.created_at < first_client.c.first_at,
        )
        .exists()
    )
    tutor_reply = (
        select(tutor_msg.c.id)
        .where(
            tutor_msg.c.conversation_id == first_client.c.cid,
            tutor_msg.c.sender_role == "TUTOR",
            tutor_msg.c.created_at >= first_client.c.first_at,
            tutor_msg.c.created_at <= first_client.c.first_at + _RESPONSE_WINDOW_SQL,
        )
        .exists()
    )
    stmt = select(
        func.count().filter(tutor_reply),
        func.count(),
    ).where(
        ~tutor_before,
        _in(first_client.c.first_at, window),
        # 24 saati dolmamış sohbet henüz "yanıtsız" sayılamaz.
        first_client.c.first_at <= now - RESPONSE_WINDOW,
    )
    replied, total = (await db.execute(stmt)).one()
    value = rate(int(replied), int(total), RESPONSE_MIN_SAMPLE)
    return _goal("RESPONSE_24H", value, RESPONSE_TARGET, "gte", int(total))


def _rating(tutor: Tutor) -> dict:
    count = int(tutor.rating_count or 0)
    value = (
        round(int(tutor.rating_sum or 0) / count, 2) if count >= RATING_MIN_SAMPLE else None
    )
    return _goal("RATING", value, RATING_TARGET, "gte", count, live=True)


async def build_goals(
    db: AsyncSession, tutor: Tutor, *, period: str, now: datetime.datetime
) -> list[dict]:
    cur, _prev = windows(now, PERIODS[period])
    return [
        await _cancel_rate(db, tutor, cur),
        await _missed_lessons(db, tutor, cur),
        await _response_24h(db, tutor, cur, now),
        _rating(tutor),
    ]


# ── Zaman serisi ─────────────────────────────────────────────────────────────


async def build_series(
    db: AsyncSession, tutor: Tutor, *, period: str, now: datetime.datetime
) -> list[dict]:
    """Seçili dönemi kovalara böler; her kova için tamamlanan ders sayısı ve
    serbest bırakılan (released) kazancı döndürür.

    Ders sayısı `Booking.end_at`, kazanç `Payment.released_at` sütununa göre
    kovalanır — `build_overview` ile aynı sütunlar (bkz. L86-108), böylece bir
    dönemin kova toplamları o dönemin `overview` sonucuyla örtüşür.
    """
    buckets = series_buckets(now, period)

    lesson_stmt = (
        select(*(func.count().filter(_in(Booking.end_at, b)) for b in buckets))
        .where(
            Booking.tutor_id == tutor.id,
            Booking.deleted_at.is_(None),
            Booking.status == BookingStatus.COMPLETED,
        )
    )
    lesson_counts = (await db.execute(lesson_stmt)).one()

    earning_stmt = (
        select(
            *(
                func.coalesce(
                    func.sum(Payment.tutor_earning).filter(_in(Payment.released_at, b)), 0
                )
                for b in buckets
            )
        )
        .select_from(Payment)
        .join(Booking, Booking.id == Payment.booking_id)
        .where(
            Booking.tutor_id == tutor.id,
            Payment.deleted_at.is_(None),
            Payment.status == PaymentStatus.RELEASED,
        )
    )
    earnings = (await db.execute(earning_stmt)).one()

    points = []
    for (start, _end), lessons, earning in zip(buckets, lesson_counts, earnings, strict=True):
        local_date = start.astimezone(TZ).date()
        points.append(
            {
                "date": local_date,
                "label": local_date.strftime("%d.%m"),
                "lessons": int(lessons),
                "earnings": _tl(earning),
            }
        )
    return points
