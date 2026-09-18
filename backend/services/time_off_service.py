"""Eğitmen izinleri (Modül 7).

İzin, haftalık müsaitlik şablonunun istisnasıdır. Aralığa düşen dersler:

* ACCEPTED ve derse ``LESSON_LATE_CANCEL_HOURS``'tan az kalmış (ya da başlamış)
  → izin **engellenir** (409). Eğitmenin 12 saat kuralı izinle aşılamaz.
* ACCEPTED ve uzak → eğitmen iptali (`booking_service.cancel`), ödenmişse iade.
* PENDING → eğitmen teklifiyse geri çekilir (`_teklifi_geri_cek_yaz`), değilse otomatik red (`booking_service.reject`), ödenmişse iade.

Yeni ders/onay/erteleme `booking_service._assert_not_on_time_off` ile izne
çarpar; yarış `booking_service._lock_tutor` ile kapanır.
"""
from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.moderation import mask_contact_info
from models.booking import Booking, BookingStatus
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from models.tutor_time_off import TutorTimeOff
from services import booking_service, notification_service

MAX_TIME_OFF_DAYS = 60
#: Takvimin tek istekte okuyabileceği en uzun aralık (iki aylık görünüm payı).
MAX_LIST_DAYS = 62
_SLOT_MINUTES = 15
_MIN_NOTE_LENGTH = 3

ERR_OVERLAP = "Bu aralıkta zaten iznin var."
ERR_BLOCKED = "Bu aralıkta 12 saatten az kalmış dersin var; izin eklenemez."
ERR_NOTE = "İptal edilecek dersler için öğrencilere kısa bir not yaz."


def _hata(mesaj: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, mesaj)


def normalize_range(
    start: datetime.datetime, end: datetime.datetime, now: datetime.datetime
) -> tuple[datetime.datetime, datetime.datetime]:
    """İzin aralığını doğrular; geçmişte kalan başlangıcı ``now``'dan sonraki
    ilk 15 dakikalık ana kırpar.

    Kırpma "bugün tüm gün" seçimini çalışır kılar: 00:00'dan başlayan izin,
    geçmiş kısmı atılarak şimdiden itibaren kaydedilir.
    """
    for an in (start, end):
        if an.minute % _SLOT_MINUTES or an.second or an.microsecond:
            raise _hata("İzin saatleri 15 dakikalık aralıklarla seçilmeli.")
    if end <= start:
        raise _hata("İzin bitişi başlangıçtan sonra olmalı.")
    if end <= now:
        raise _hata("Geçmiş bir tarihe izin eklenemez.")
    if start < now:
        # Kırpılan başlangıç bir sonraki 15 dakikaya yuvarlanır: saniye taşıyan
        # bir an kaydedilmez ve takvim ızgarasına oturur.
        kalan = now.replace(second=0, microsecond=0)
        if kalan != now or kalan.minute % _SLOT_MINUTES:
            kalan += datetime.timedelta(minutes=_SLOT_MINUTES - kalan.minute % _SLOT_MINUTES)
        start = kalan
        if end <= start:
            raise _hata("Geçmiş bir tarihe izin eklenemez.")
    if end - start > datetime.timedelta(days=MAX_TIME_OFF_DAYS):
        raise _hata(f"İzin en fazla {MAX_TIME_OFF_DAYS} gün olabilir.")
    return start, end


def _engelli_mi(booking: Booking, now: datetime.datetime) -> bool:
    """Onaylı ve 12 saat eşiğinin içinde (ya da başlamış) ders izni engeller."""
    return booking.status == BookingStatus.ACCEPTED and booking_service.is_late_for_changes(
        booking, now
    )


async def list_time_off(
    db: AsyncSession,
    tutor: Tutor,
    *,
    start: datetime.datetime,
    end: datetime.datetime,
) -> list[TutorTimeOff]:
    stmt = (
        select(TutorTimeOff)
        .where(
            TutorTimeOff.tutor_id == tutor.id,
            TutorTimeOff.start_at < end,
            TutorTimeOff.end_at > start,
        )
        .order_by(TutorTimeOff.start_at.asc())
    )
    return list((await db.execute(stmt)).scalars().all())


async def conflicting_bookings(
    db: AsyncSession,
    tutor: Tutor,
    *,
    start: datetime.datetime,
    end: datetime.datetime,
    now: datetime.datetime,
) -> list[tuple[Booking, bool]]:
    """Aralıkla kesişen aktif dersler ve her biri için ``can_cancel``."""
    stmt = (
        booking_service._hydrated_booking_select()
        .where(
            Booking.tutor_id == tutor.id,
            Booking.status.in_([BookingStatus.PENDING, BookingStatus.ACCEPTED]),
            Booking.start_at < end,
            Booking.end_at > start,
        )
        .order_by(Booking.start_at.asc())
    )
    rows = (await db.execute(stmt)).all()
    bookings = await booking_service._hydrate_booking_rows(
        db, rows, role_id=ROLE_IDS[RoleType.TUTOR], user_id=tutor.id
    )
    return [(b, not _engelli_mi(b, now)) for b in bookings]


async def preview(
    db: AsyncSession,
    tutor: Tutor,
    *,
    start: datetime.datetime,
    end: datetime.datetime,
    now: datetime.datetime,
) -> dict:
    """Salt okunur önizleme: izin eklenirse hangi dersler etkilenir."""
    start, end = normalize_range(start, end, now)
    pairs = await conflicting_bookings(db, tutor, start=start, end=end, now=now)
    return {
        "start_at": start,
        "end_at": end,
        "bookings": [{"booking": b, "can_cancel": ok} for b, ok in pairs],
        "blocked": any(not ok for _b, ok in pairs),
        # Kayıt aynı kontrolü kilit altında tekrarlar (409); önizleme önceden söyler.
        "overlap": bool(await list_time_off(db, tutor, start=start, end=end)),
    }


async def create_time_off(
    db: AsyncSession,
    tutor: Tutor,
    *,
    start: datetime.datetime,
    end: datetime.datetime,
    title: str | None,
    note: str | None,
    now: datetime.datetime,
) -> dict:
    """İki aşamalı izin ekleme.

    **Neden tek transaction değil:** `payment_service.refund` →
    `escrow.begin_refund` iade niyetini claim eder etmez COMMIT eder. Dersleri
    izinle aynı transaction'da iptal etmek "hepsi ya da hiçbiri" vermez; ilk
    iadeden sonra geri alma zaten imkânsızdır.

    Aşama 1 (eğitmen kilidi altında): çakışma/engel/not kontrolü, izin satırı,
    COMMIT. Bu andan sonra aralığa yeni ders giremez.
    Aşama 2: dersler tek tek mevcut servis yoluyla iptal/red edilir; her başarılı
    ders ayrıca commit edilir. Arada durumu değişmiş (yarış) ders atlanır ve
    ``skipped_ids``'e yazılır — izin geri alınmaz.
    """
    start, end = normalize_range(start, end, now)

    # ── Aşama 1 ─────────────────────────────────────────────────────────────
    await booking_service._lock_tutor(db, tutor.id)
    if await list_time_off(db, tutor, start=start, end=end):
        raise HTTPException(status.HTTP_409_CONFLICT, ERR_OVERLAP)
    pairs = await conflicting_bookings(db, tutor, start=start, end=end, now=now)
    if any(not ok for _b, ok in pairs):
        raise HTTPException(status.HTTP_409_CONFLICT, ERR_BLOCKED)
    temiz_not = (note or "").strip()
    if pairs and len(temiz_not) < _MIN_NOTE_LENGTH:
        raise _hata(ERR_NOTE)

    time_off = TutorTimeOff(
        tutor_id=tutor.id,
        start_at=start,
        end_at=end,
        title=(title or "").strip() or None,
    )
    db.add(time_off)
    await db.flush()
    await db.commit()
    # Aşama 2'deki olası rollback nesneleri expire eder; yanıt şimdiden alınır.
    time_off_out = {
        "id": time_off.id,
        "start_at": time_off.start_at,
        "end_at": time_off.end_at,
        "title": time_off.title,
    }

    # ── Aşama 2 ─────────────────────────────────────────────────────────────
    reason = f"Eğitmen izinde: {mask_contact_info(temiz_not)}" if pairs else None
    cancelled = 0
    skipped: list[int] = []
    for booking_id in [b.id for b, _ok in pairs]:
        try:
            locked = await booking_service._lock_booking(db, Booking(id=booking_id))
            if locked is None:
                raise HTTPException(status.HTTP_409_CONFLICT, "Booking not found")
            # Aşama 1'den sonra kilit bırakıldı: ders arada izin dışına
            # ertelenmiş olabilir (reschedule yeni saati izne karşı doğrular).
            # Artık izinle kesişmeyen ders iptal/red edilmez, atlanır.
            if not (locked.start_at < end and locked.end_at > start):
                raise HTTPException(status.HTTP_409_CONFLICT, "Booking moved")
            if locked.status == BookingStatus.PENDING and locked.offered_by_tutor:
                # Eğitmenin kendi teklifi geri çekilir: öğrenci reddi sayılmaz
                # (haftalık seri K10) ve eğitmene "reddedildi" bildirimi gitmez.
                # Ödemesi olan teklif claim'e takılır; iade için red yoluna düşer.
                if await booking_service._teklifi_geri_cek_yaz(db, locked, reason=reason):
                    await notification_service.notify(
                        db,
                        user_id=locked.client_id,
                        role_id=ROLE_IDS[RoleType.CLIENT],
                        message=f"{tutor.full_name} ders teklifini geri çekti. {reason}",
                        link=f"/ders-talepleri/{locked.id}",
                    )
                else:
                    await booking_service.reject(db, locked, reason=reason)
            elif locked.status == BookingStatus.PENDING:
                await booking_service.reject(db, locked, reason=reason)
            else:
                await booking_service.cancel(db, locked, cancelled_by=tutor, reason=reason)
            await db.commit()
            cancelled += 1
        except HTTPException as exc:
            if exc.status_code not in (
                status.HTTP_409_CONFLICT,
                status.HTTP_422_UNPROCESSABLE_ENTITY,
            ):
                raise
            # Başarısız dersin yazdıkları (varsa) geri alınır; önceki dersler
            # zaten commit edildi. ws_outbox session.info'da durduğu için
            # rollback kuyruğu silmez.
            await db.rollback()
            if tutor in db:
                await db.refresh(tutor)
            skipped.append(booking_id)

    return {
        "time_off": time_off_out,
        "cancelled_count": cancelled,
        "skipped_ids": skipped,
    }


async def delete_time_off(db: AsyncSession, tutor: Tutor, time_off_id: int) -> None:
    """İzni kaldırır. Sahiplik sorguda: başka eğitmenin izni 404 (varlık ifşa edilmez)."""
    result = await db.execute(
        delete(TutorTimeOff).where(
            TutorTimeOff.id == time_off_id, TutorTimeOff.tutor_id == tutor.id
        )
    )
    if result.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "İzin bulunamadı.")
