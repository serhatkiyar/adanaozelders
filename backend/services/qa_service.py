from __future__ import annotations

import datetime
import math

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.config import settings
from models.booking import Booking, BookingStatus
from models.client import Client
from models.qa import QAMessage, QAStatus, QAThread
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from schemas.qa import LessonQuestionGroup, QAThreadCreate, QAThreadOut


async def _load_thread(db: AsyncSession, thread_id: int) -> QAThread | None:
    return await db.scalar(
        select(QAThread)
        .options(selectinload(QAThread.messages))
        .where(QAThread.id == thread_id)
    )


async def create_thread(
    db: AsyncSession, client: Client, data: QAThreadCreate
) -> QAThread:
    booking = await db.get(Booking, data.booking_id)
    if booking is None or booking.deleted_at is not None or booking.client_id != client.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    if booking.status != BookingStatus.COMPLETED:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Questions can only be asked for completed lessons",
        )

    # Tamamlanmış ders, bitiminden QA_QUOTA_WINDOW_DAYS gün sonrasına kadar soru hakkı verir.
    # Ders erken tamamlanmış olabilir (end_at gelecekte) — bu soru sormayı engellemez.
    now = datetime.datetime.now(datetime.timezone.utc)
    closes_at = booking.end_at + datetime.timedelta(days=settings.QA_QUOTA_WINDOW_DAYS)
    if now > closes_at:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Question window closed (7 days after the lesson)",
        )

    new_used = await db.scalar(
        update(Booking)
        .where(
            Booking.id == booking.id,
            Booking.qa_used < settings.QA_QUESTIONS_PER_LESSON,
        )
        .values(qa_used=Booking.qa_used + 1)
        .returning(Booking.qa_used)
    )
    if new_used is None:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Question quota for this lesson ({settings.QA_QUESTIONS_PER_LESSON}) exceeded",
        )

    thread = QAThread(
        client_id=client.id,
        tutor_id=booking.tutor_id,
        booking_id=booking.id,
        subject=data.subject,
        question=data.question,
        messages=[QAMessage(sender_role="CLIENT", body=data.question)],
    )
    db.add(thread)
    await db.flush()
    full = await _load_thread(db, thread.id)
    tutor = await db.get(Tutor, full.tutor_id)
    full.tutor_name = tutor.full_name if tutor else None
    full.tutor_avatar_url = tutor.avatar_url if tutor else None
    full.client_name = client.full_name
    full.client_avatar_url = client.avatar_url
    return full


async def post_message(
    db: AsyncSession, thread: QAThread, *, sender_role: str, body: str
) -> QAThread:
    """Mevcut soru başlığına takip mesajı ekler (kota tüketmez). İki taraf da
    yazabilir; başlık kapalı değilse ve ders penceresi açıkken."""
    if thread.status == QAStatus.CLOSED:
        raise HTTPException(status.HTTP_409_CONFLICT, "Thread is closed")

    now = datetime.datetime.now(datetime.timezone.utc)
    if thread.booking_id is not None:
        booking = await db.get(Booking, thread.booking_id)
        if booking is not None:
            closes_at = booking.end_at + datetime.timedelta(
                days=settings.QA_QUOTA_WINDOW_DAYS
            )
            if now > closes_at:
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN,
                    "Question window closed (7 days after the lesson)",
                )

    thread.messages.append(QAMessage(sender_role=sender_role, body=body))
    # Durum son mesaja göre: eğitmen yazdıysa yanıtlandı, öğrenci yazdıysa yanıt bekliyor.
    thread.status = (
        QAStatus.ANSWERED if sender_role == "TUTOR" else QAStatus.OPEN
    )
    if sender_role == "TUTOR" and thread.answer is None:
        thread.answer = body  # legacy alan: ilk eğitmen yanıtı
        thread.answered_at = now
    await db.flush()
    return await _load_thread(db, thread.id)


async def answer_thread(db: AsyncSession, thread: QAThread, answer: str) -> QAThread:
    # Geriye dönük uyumlu uç: eğitmen yanıtını mesaj akışına yazar.
    return await post_message(db, thread, sender_role="TUTOR", body=answer)


async def close_thread(db: AsyncSession, thread: QAThread) -> QAThread:
    if thread.status == QAStatus.CLOSED:
        raise HTTPException(status.HTTP_409_CONFLICT, "Thread already closed")
    thread.status = QAStatus.CLOSED
    await db.flush()
    return thread


async def get_thread(db: AsyncSession, thread_id: int) -> QAThread | None:
    thread = await _load_thread(db, thread_id)
    if thread is None or thread.deleted_at is not None:
        return None
    tutor = await db.get(Tutor, thread.tutor_id)
    client = await db.get(Client, thread.client_id)
    thread.tutor_name = tutor.full_name if tutor else None
    thread.tutor_avatar_url = tutor.avatar_url if tutor else None
    thread.client_name = client.full_name if client else None
    thread.client_avatar_url = client.avatar_url if client else None
    return thread


async def list_threads(
    db: AsyncSession,
    *,
    role_id: int,
    user_id: int,
    status_filter: QAStatus | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[QAThread]:
    stmt = (
        select(QAThread, Tutor.full_name, Tutor.avatar_url, Client.full_name, Client.avatar_url)
        .options(selectinload(QAThread.messages))
        .join(Tutor, QAThread.tutor_id == Tutor.id)
        .join(Client, QAThread.client_id == Client.id)
        .where(QAThread.deleted_at.is_(None))
    )
    if role_id == ROLE_IDS[RoleType.CLIENT]:
        stmt = stmt.where(QAThread.client_id == user_id)
    elif role_id == ROLE_IDS[RoleType.TUTOR]:
        stmt = stmt.where(QAThread.tutor_id == user_id)
    else:
        return []
    if status_filter is not None:
        stmt = stmt.where(QAThread.status == status_filter)
    stmt = stmt.order_by(QAThread.created_at.desc()).limit(limit).offset(offset)

    threads: list[QAThread] = []
    for thread, tutor_name, tutor_avatar, client_name, client_avatar in (await db.execute(stmt)).all():
        thread.tutor_name = tutor_name
        thread.tutor_avatar_url = tutor_avatar
        thread.client_name = client_name
        thread.client_avatar_url = client_avatar
        threads.append(thread)
    return threads


async def list_question_rights(
    db: AsyncSession, client: Client
) -> list[LessonQuestionGroup]:
    """Öğrencinin tamamlanmış derslerini, ders başına soru hakkı ve o derste
    sorulmuş sorularla birlikte kümelenmiş döner. Aktif hak penceresindeki ya da
    en az bir sorusu olan dersler dahildir (geçmiş silinmez)."""
    now = datetime.datetime.now(datetime.timezone.utc)
    window_days = settings.QA_QUOTA_WINDOW_DAYS
    quota = settings.QA_QUESTIONS_PER_LESSON

    rows = (
        await db.execute(
            select(Booking, Tutor.full_name, Tutor.avatar_url, Tutor.headline)
            .join(Tutor, Booking.tutor_id == Tutor.id)
            .where(
                Booking.client_id == client.id,
                Booking.status == BookingStatus.COMPLETED,
                Booking.deleted_at.is_(None),
            )
            .order_by(Booking.end_at.desc())
        )
    ).all()
    if not rows:
        return []

    booking_ids = [b.id for b, _, _, _ in rows]
    threads = (
        (
            await db.execute(
                select(QAThread)
                .options(selectinload(QAThread.messages))
                .where(
                    QAThread.booking_id.in_(booking_ids),
                    QAThread.deleted_at.is_(None),
                )
                .order_by(QAThread.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    by_booking: dict[int, list[QAThread]] = {}
    for t in threads:
        by_booking.setdefault(t.booking_id, []).append(t)

    groups: list[LessonQuestionGroup] = []
    for booking, full_name, avatar_url, headline in rows:
        b_threads = by_booking.get(booking.id, [])
        used = len(b_threads)
        # Tamamlanmış ders, bitiminden window_days gün sonrasına kadar aktiftir.
        # end_at gelecekte olsa bile (erken tamamlanan ders) hak aktiftir.
        closes_at = booking.end_at + datetime.timedelta(days=window_days)
        expired = now > closes_at

        if expired and used == 0:
            continue  # süresi dolmuş ve hiç soru yok → gizle

        remaining = max(quota - used, 0) if not expired else 0
        can_ask = not expired and remaining > 0
        days_left = (
            max(0, math.ceil((closes_at - now).total_seconds() / 86400))
            if not expired
            else 0
        )

        for t in b_threads:
            t.tutor_name = full_name
            t.tutor_avatar_url = avatar_url
            t.client_name = client.full_name
            t.client_avatar_url = client.avatar_url

        groups.append(
            LessonQuestionGroup(
                booking_id=booking.id,
                tutor_id=booking.tutor_id,
                tutor_name=full_name,
                tutor_avatar_url=avatar_url,
                tutor_headline=headline,
                start_at=booking.start_at,
                end_at=booking.end_at,
                quota=quota,
                used=used,
                remaining=remaining,
                can_ask=can_ask,
                expired=expired,
                days_left=days_left,
                threads=[QAThreadOut.model_validate(t) for t in b_threads],
            )
        )
    return groups
