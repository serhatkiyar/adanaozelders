"""Kütüphane çalışma alanı — saatlik koltuk rezervasyonu (kontenjan bazlı).

Belirli koltuk değil: [starts_at, ends_at) penceresinde boş kapasite varsa rezerve
edilir. Ücret = kütüphane saatlik ücreti × süre. Escrow + QR akışı deneme
oturumlarıyla (ExamRegistration) birebir aynıdır; ``core/payments`` charge/refund
için kullanılır. No-show iadesi yoktur (ödenmiş rezervasyon iptal edilemez).
"""

from __future__ import annotations

import datetime
import secrets
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core import payments
from core.codes import gen_short_code, normalize_code
from core.config import settings
from models.client import Client
from models.library import Library, LibraryHours
from models.library_exam import ACTIVE_REGISTRATION_STATUSES, RegistrationStatus
from models.role import ROLE_IDS, RoleType
from models.study_reservation import StudyReservation
from schemas.library_exam import AttendanceResult
from schemas.study import StudyQuoteOut, StudyReservationOut
from services import notification_service

try:
    from zoneinfo import ZoneInfo

    _TZ = ZoneInfo("Europe/Istanbul")
except Exception:  # noqa: BLE001
    _TZ = datetime.timezone(datetime.timedelta(hours=3))

_MIN_MINUTES = 30
_MAX_HOURS = 14


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _split(amount: Decimal) -> tuple[Decimal, Decimal]:
    rate = Decimal(str(settings.PLATFORM_COMMISSION_RATE))
    commission = (amount * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    earning = (amount - commission).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return commission, earning


def _hours(starts: datetime.datetime, ends: datetime.datetime) -> Decimal:
    minutes = Decimal((ends - starts).total_seconds()) / Decimal(60)
    return (minutes / Decimal(60)).quantize(Decimal("0.01"))


def compute_amount(hourly_price: Decimal, starts: datetime.datetime, ends: datetime.datetime) -> Decimal:
    """Saatlik ücret × süre (saat). Saf — test edilebilir."""
    amount = hourly_price * _hours(starts, ends)
    return amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


async def _unique_short_code(db: AsyncSession) -> str:
    """Aktif (PAID/ATTENDED) rezervasyonlar arasında benzersiz kısa kod üretir."""
    while True:
        code = gen_short_code()
        exists = (
            await db.execute(
                select(StudyReservation.id).where(
                    StudyReservation.short_code == code,
                    StudyReservation.status.in_(ACTIVE_REGISTRATION_STATUSES),
                    StudyReservation.deleted_at.is_(None),
                )
            )
        ).first()
        if exists is None:
            return code


async def _overlap_count(
    db: AsyncSession,
    library_id: int,
    starts: datetime.datetime,
    ends: datetime.datetime,
) -> int:
    """Verilen pencereyle çakışan aktif (ödenmiş/katılmış) rezervasyon sayısı."""
    stmt = select(func.count()).where(
        StudyReservation.library_id == library_id,
        StudyReservation.status.in_(ACTIVE_REGISTRATION_STATUSES),
        StudyReservation.deleted_at.is_(None),
        StudyReservation.starts_at < ends,
        StudyReservation.ends_at > starts,
    )
    return int((await db.execute(stmt)).scalar_one())


async def _validate_window(
    db: AsyncSession,
    library: Library,
    starts: datetime.datetime,
    ends: datetime.datetime,
) -> None:
    if ends <= starts:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bitiş başlangıçtan sonra olmalı")
    if starts < _now():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Geçmiş bir saat seçilemez")
    minutes = (ends - starts).total_seconds() / 60
    if minutes < _MIN_MINUTES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"En az {_MIN_MINUTES} dakika rezerve edilebilir"
        )
    if minutes > _MAX_HOURS * 60:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"En fazla {_MAX_HOURS} saat rezerve edilebilir"
        )
    # Çalışma saatleri içinde mi (best-effort; saat tanımı yoksa atla).
    await _assert_within_hours(db, library.id, starts, ends)


async def _assert_within_hours(
    db: AsyncSession,
    library_id: int,
    starts: datetime.datetime,
    ends: datetime.datetime,
) -> None:
    rows = (
        await db.execute(
            select(LibraryHours).where(LibraryHours.library_id == library_id)
        )
    ).scalars().all()
    if not rows:
        return  # saat tanımlı değil → kısıtlama yok
    local_start = starts.astimezone(_TZ)
    local_end = ends.astimezone(_TZ)
    # Tek güne sığmalı (gece yarısını aşan rezervasyonu reddet — sade tutar).
    if local_start.date() != (local_end - datetime.timedelta(seconds=1)).date():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Rezervasyon tek gün içinde olmalı"
        )
    weekday = local_start.weekday()
    day = next((h for h in rows if h.weekday == weekday), None)
    if day is None or day.is_closed or day.open_minute is None or day.close_minute is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Kütüphane o gün kapalı")
    start_min = local_start.hour * 60 + local_start.minute
    end_min = local_end.hour * 60 + local_end.minute
    if end_min == 0:  # gece yarısı = 1440
        end_min = 1440
    if start_min < day.open_minute or end_min > day.close_minute:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Seçilen saat kütüphane çalışma saatleri dışında"
        )


def _ensure_study_enabled(library: Library) -> Decimal:
    if not library.capacity or library.study_hourly_price is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Bu kütüphanede çalışma alanı rezervasyonu sunulmuyor",
        )
    return Decimal(str(library.study_hourly_price))


def _res_out(
    r: StudyReservation,
    *,
    library: Library | None = None,
    client_name: str | None = None,
) -> StudyReservationOut:
    out = StudyReservationOut.model_validate(r)
    out.amount = str(r.amount)
    if r.status != RegistrationStatus.PAID.value:
        out.qr_token = None
        out.short_code = None
    if library is not None:
        out.library_name = library.name
        out.library_slug = library.slug
    if client_name is not None:
        out.client_name = client_name
    return out


# ── Public quote (fiyat + uygunluk) ──────────────────────────────────────────────


async def quote(
    db: AsyncSession,
    library_id: int,
    starts: datetime.datetime,
    ends: datetime.datetime,
) -> StudyQuoteOut:
    library = await db.get(Library, library_id)
    if library is None or library.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kütüphane bulunamadı")
    hourly = _ensure_study_enabled(library)
    hours = float(_hours(starts, ends))
    amount = compute_amount(hourly, starts, ends)

    reason: str | None = None
    available = True
    try:
        await _validate_window(db, library, starts, ends)
    except HTTPException as e:
        available = False
        reason = e.detail

    used = await _overlap_count(db, library_id, starts, ends)
    remaining = max(0, (library.capacity or 0) - used)
    if available and remaining <= 0:
        available = False
        reason = "Seçilen saatte kapasite dolu"

    return StudyQuoteOut(
        available=available,
        capacity=library.capacity or 0,
        remaining=remaining,
        hourly_price=str(hourly),
        hours=hours,
        amount=str(amount),
        currency=settings.PAYMENT_CURRENCY,
        reason=reason,
    )


# ── Öğrenci: rezerve + öde ───────────────────────────────────────────────────────


async def reserve(
    db: AsyncSession,
    client: Client,
    *,
    library_id: int,
    starts: datetime.datetime,
    ends: datetime.datetime,
) -> StudyReservationOut:
    library = await db.get(Library, library_id)
    if library is None or library.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kütüphane bulunamadı")
    hourly = _ensure_study_enabled(library)
    await _validate_window(db, library, starts, ends)

    used = await _overlap_count(db, library_id, starts, ends)
    if used >= (library.capacity or 0):
        raise HTTPException(status.HTTP_409_CONFLICT, "Seçilen saatte kapasite dolu")

    # Öğrencinin bu pencereyle çakışan ÖDENMEMİŞ (askıda) holdlerini iptal et: terk
    # edilmiş bir ödeme denemesi (PENDING_PAYMENT) aynı öğrenciyi aynı slottan kalıcı
    # olarak engellememeli. Askıdaki holdler kapasiteyi de tüketmez.
    stale = (
        await db.execute(
            select(StudyReservation).where(
                StudyReservation.client_id == client.id,
                StudyReservation.library_id == library_id,
                StudyReservation.deleted_at.is_(None),
                StudyReservation.status == RegistrationStatus.PENDING_PAYMENT.value,
                StudyReservation.starts_at < ends,
                StudyReservation.ends_at > starts,
            )
        )
    ).scalars().all()
    for s in stale:
        s.status = RegistrationStatus.CANCELLED.value

    # Yalnız ÖDENMİŞ/aktif çakışan rezervasyon varsa engelle (çift ödeme olmasın).
    own = (
        await db.execute(
            select(func.count()).where(
                StudyReservation.client_id == client.id,
                StudyReservation.library_id == library_id,
                StudyReservation.deleted_at.is_(None),
                StudyReservation.status.in_(ACTIVE_REGISTRATION_STATUSES),
                StudyReservation.starts_at < ends,
                StudyReservation.ends_at > starts,
            )
        )
    ).scalar_one()
    if own:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Bu saat aralığında zaten ödenmiş bir rezervasyonun var",
        )

    amount = compute_amount(hourly, starts, ends)
    commission, earning = _split(amount)
    res = StudyReservation(
        library_id=library_id,
        client_id=client.id,
        starts_at=starts,
        ends_at=ends,
        status=RegistrationStatus.PENDING_PAYMENT.value,
        hourly_price=hourly,
        amount=amount,
        commission_amount=commission,
        library_earning=earning,
        commission_rate=Decimal(str(settings.PLATFORM_COMMISSION_RATE)),
        currency=settings.PAYMENT_CURRENCY,
    )
    db.add(res)
    await db.commit()
    await db.refresh(res)
    return _res_out(res, library=library)


async def pay(
    db: AsyncSession, client: Client, reservation_id: int
) -> tuple[StudyReservationOut, str | None]:
    res = await db.get(StudyReservation, reservation_id)
    if res is None or res.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rezervasyon bulunamadı")
    if res.client_id != client.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sizin rezervasyonunuz değil")
    if res.status in (RegistrationStatus.PAID.value, RegistrationStatus.ATTENDED.value):
        return _res_out(res), None
    if res.status != RegistrationStatus.PENDING_PAYMENT.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu rezervasyon için ödeme yapılamaz")

    provider = payments.get_payment_provider()
    provider_ref: str | None = None
    if Decimal(str(res.amount)) > 0:
        result = await provider.charge(
            amount=Decimal(str(res.amount)),
            currency=res.currency,
            booking_id=res.id,
            description=f"Calisma Alani Rez. #{res.id}",
        )
        if result.redirect_url:
            res.provider = provider.name
            res.provider_ref = result.provider_ref
            await db.commit()
            await db.refresh(res)
            return _res_out(res), result.redirect_url
        if not result.success:
            await db.commit()
            raise HTTPException(
                status.HTTP_402_PAYMENT_REQUIRED, result.error or "Ödeme başarısız"
            )
        provider_ref = result.provider_ref

    res.status = RegistrationStatus.PAID.value
    res.provider = provider.name
    res.provider_ref = provider_ref
    res.paid_at = _now()
    res.qr_token = secrets.token_urlsafe(24)
    res.short_code = await _unique_short_code(db)
    await db.commit()
    await db.refresh(res)
    return _res_out(res), None


async def cancel(db: AsyncSession, client: Client, reservation_id: int) -> None:
    res = await db.get(StudyReservation, reservation_id)
    if res is None or res.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rezervasyon bulunamadı")
    if res.client_id != client.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sizin rezervasyonunuz değil")
    if res.status != RegistrationStatus.PENDING_PAYMENT.value:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Ödenmiş rezervasyon iptal edilemez (iade yok). Yalnız ödeme öncesi iptal edilebilir.",
        )
    res.status = RegistrationStatus.CANCELLED.value
    await db.commit()


async def list_mine(db: AsyncSession, client: Client) -> list[StudyReservationOut]:
    rows = (
        await db.execute(
            select(StudyReservation, Library)
            .join(Library, Library.id == StudyReservation.library_id)
            .where(
                StudyReservation.client_id == client.id,
                StudyReservation.deleted_at.is_(None),
                StudyReservation.status != RegistrationStatus.CANCELLED.value,
            )
            .order_by(StudyReservation.starts_at.desc())
        )
    ).all()
    return [_res_out(r, library=lib) for r, lib in rows]


async def list_manage(
    db: AsyncSession, library_id: int
) -> list[StudyReservationOut]:
    """Operatör/admin: kütüphanenin yaklaşan ödenmiş rezervasyonları (katılımcı adıyla)."""
    rows = (
        await db.execute(
            select(StudyReservation, Library, Client)
            .join(Library, Library.id == StudyReservation.library_id)
            .join(Client, Client.id == StudyReservation.client_id)
            .where(
                StudyReservation.library_id == library_id,
                StudyReservation.deleted_at.is_(None),
                StudyReservation.status.in_(ACTIVE_REGISTRATION_STATUSES),
                StudyReservation.ends_at >= _now(),
            )
            .order_by(StudyReservation.starts_at.asc())
        )
    ).all()
    return [
        _res_out(r, library=lib, client_name=cl.full_name) for r, lib, cl in rows
    ]


def _window_label(res: StudyReservation) -> str:
    local_s = res.starts_at.astimezone(_TZ)
    local_e = res.ends_at.astimezone(_TZ)
    return f"Çalışma Alanı · {local_s:%d.%m %H:%M}–{local_e:%H:%M}"


async def verify_attendance(
    db: AsyncSession,
    *,
    operator_library_id: int,
    operator_id: int,
    token: str,
    code: str | None = None,
) -> AttendanceResult | None:
    """QR token'ı (veya elle girilen kısa kodu) çalışma rezervasyonlarında arar. Bulup
    doğrularsa AttendanceResult döner; eşleşme YOKSA None (çağıran deneme oturumlarına
    bakar — birleşik QR doğrulama). Operatör yalnız kendi kütüphanesini doğrular."""
    conds = [StudyReservation.qr_token == token]
    if code:
        conds.append(StudyReservation.short_code == code)
    res = (
        await db.execute(
            select(StudyReservation).where(
                or_(*conds),
                StudyReservation.deleted_at.is_(None),
            )
        )
    ).scalars().first()
    if res is None:
        return None
    return await _attend_study(
        db, res, operator_library_id=operator_library_id, operator_id=operator_id
    )


async def verify_by_reservation(
    db: AsyncSession, *, operator_library_id: int, operator_id: int, reservation_id: int
) -> AttendanceResult:
    """Operatör rezervasyon listesinden seçip girişi doğrular (QR/kod olmadan)."""
    res = await db.get(StudyReservation, reservation_id)
    if res is None or res.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rezervasyon bulunamadı")
    return await _attend_study(
        db, res, operator_library_id=operator_library_id, operator_id=operator_id
    )


async def _attend_study(
    db: AsyncSession,
    res: StudyReservation,
    *,
    operator_library_id: int,
    operator_id: int,
) -> AttendanceResult:
    """Yüklenmiş bir rezervasyon için girişi işaretler + emaneti serbest bırakır.
    QR/kod ve listeden-seç yollarının paylaştığı çekirdek."""
    client = await db.get(Client, res.client_id)
    client_name = client.full_name if client else "Öğrenci"

    if res.library_id != operator_library_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Bu rezervasyon sizin kütüphanenize ait değil"
        )
    if res.status == RegistrationStatus.ATTENDED.value:
        return AttendanceResult(
            registration_id=res.id,
            client_name=client_name,
            exam_title=_window_label(res),
            status=res.status,
            already=True,
            message="Bu giriş zaten doğrulanmıştı.",
        )
    if res.status != RegistrationStatus.PAID.value:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Bu rezervasyon ödenmemiş; giriş doğrulanamaz"
        )

    res.status = RegistrationStatus.ATTENDED.value
    res.attended_at = _now()
    res.attended_by_operator_id = operator_id
    res.released_at = _now()
    await notification_service.notify(
        db,
        user_id=res.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message="Çalışma alanı rezervasyon girişin doğrulandı.",
        link="/biletlerim",
    )
    await db.commit()
    return AttendanceResult(
        registration_id=res.id,
        client_name=client_name,
        exam_title=_window_label(res),
        status=res.status,
        already=False,
        message="Giriş doğrulandı ✓",
    )
