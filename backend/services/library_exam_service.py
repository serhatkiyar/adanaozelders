"""Kütüphane deneme sınavı oturumları — iş mantığı.

Etkinlik + biletleme + escrow: kütüphane (admin/operatör) ücretli deneme oturumu açar;
öğrenci kaydolur ve online öder (escrow HELD); oturum günü operatör QR okutarak
katılımı doğrular → emanet kütüphaneye serbest (RELEASED). No-show iadesi yoktur.
Ödeme escrow alanları ExamRegistration'da gömülüdür; ``core/payments`` yalnız
charge/refund için kullanılır (booking Payment'tan bağımsız akış).
"""

from __future__ import annotations

import datetime
import secrets
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core import payments
from core.codes import gen_short_code, normalize_code
from core.config import settings
from models.client import Client
from models.library import Library
from models.library_exam import (
    ACTIVE_REGISTRATION_STATUSES,
    ExamRegistration,
    ExamSessionStatus,
    LibraryExamSession,
    RegistrationStatus,
)
from models.role import ROLE_IDS, RoleType
from schemas.library_exam import (
    AttendanceResult,
    ExamSessionCreate,
    ExamSessionOut,
    ExamSessionUpdate,
    RegistrationOut,
)
from services import notification_service


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _split(amount: Decimal) -> tuple[Decimal, Decimal]:
    """(komisyon, kütüphane_kazancı). Komisyon = amount × oran, 2 ondalık (HALF_UP)."""
    rate = Decimal(str(settings.PLATFORM_COMMISSION_RATE))
    commission = (amount * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    earning = (amount - commission).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return commission, earning


def parse_qr_token(payload: str) -> str:
    """QR içeriğinden bilet token'ını çıkarır. İçerik "{registration_id}:{token}" ya
    da salt token olabilir; her iki halde token döner (saf — test edilebilir)."""
    token = payload.strip()
    if ":" in token:
        token = token.split(":", 1)[1]
    return token


async def _unique_short_code(db: AsyncSession) -> str:
    """Aktif (PAID/ATTENDED) deneme biletleri arasında benzersiz kısa kod üretir."""
    while True:
        code = gen_short_code()
        exists = (
            await db.execute(
                select(ExamRegistration.id).where(
                    ExamRegistration.short_code == code,
                    ExamRegistration.status.in_(ACTIVE_REGISTRATION_STATUSES),
                    ExamRegistration.deleted_at.is_(None),
                )
            )
        ).first()
        if exists is None:
            return code


async def _count_active(db: AsyncSession, session_id: int) -> int:
    stmt = select(func.count()).where(
        ExamRegistration.session_id == session_id,
        ExamRegistration.status.in_(ACTIVE_REGISTRATION_STATUSES),
        ExamRegistration.deleted_at.is_(None),
    )
    return int((await db.execute(stmt)).scalar_one())


def _session_out(
    s: LibraryExamSession,
    *,
    registered_count: int,
    library_name: str | None = None,
    library_slug: str | None = None,
    my_status: str | None = None,
    my_registration_id: int | None = None,
) -> ExamSessionOut:
    return ExamSessionOut(
        id=s.id,
        library_id=s.library_id,
        library_name=library_name,
        library_slug=library_slug,
        exam_type=s.exam_type,
        title=s.title,
        description=s.description,
        starts_at=s.starts_at,
        duration_minutes=s.duration_minutes,
        capacity=s.capacity,
        price=str(s.price),
        currency=s.currency,
        status=s.status,
        registered_count=registered_count,
        available=max(0, s.capacity - registered_count),
        my_status=my_status,
        my_registration_id=my_registration_id,
    )


async def _get_session_or_404(db: AsyncSession, session_id: int) -> LibraryExamSession:
    s = await db.get(LibraryExamSession, session_id)
    if s is None or s.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Oturum bulunamadı")
    return s


# ── Oturum yönetimi (admin / operatör) ──────────────────────────────────────────


async def create_session(
    db: AsyncSession, library_id: int, payload: ExamSessionCreate
) -> ExamSessionOut:
    lib = await db.get(Library, library_id)
    if lib is None or lib.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kütüphane bulunamadı")
    s = LibraryExamSession(
        library_id=library_id,
        exam_type=payload.exam_type.strip().upper(),
        title=payload.title.strip(),
        description=payload.description,
        starts_at=payload.starts_at,
        duration_minutes=payload.duration_minutes,
        capacity=payload.capacity,
        price=Decimal(str(payload.price)),
        currency=settings.PAYMENT_CURRENCY,
        status=ExamSessionStatus.SCHEDULED.value,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return _session_out(s, registered_count=0, library_name=lib.name, library_slug=lib.slug)


async def update_session(
    db: AsyncSession, session_id: int, payload: ExamSessionUpdate
) -> ExamSessionOut:
    s = await _get_session_or_404(db, session_id)
    data = payload.model_dump(exclude_unset=True)
    if "exam_type" in data and data["exam_type"]:
        s.exam_type = data["exam_type"].strip().upper()
    for field in ("title", "description", "starts_at", "duration_minutes", "capacity"):
        if field in data and data[field] is not None:
            setattr(s, field, data[field])
    if "price" in data and data["price"] is not None:
        s.price = Decimal(str(data["price"]))
    # Kapasiteyi mevcut aktif kayıt sayısının altına indirmeyi engelle.
    active = await _count_active(db, s.id)
    if s.capacity < active:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Kapasite mevcut kayıt sayısının ({active}) altına indirilemez",
        )
    await db.commit()
    await db.refresh(s)
    return _session_out(s, registered_count=active)


async def cancel_session(db: AsyncSession, session_id: int) -> ExamSessionOut:
    """Oturumu iptal eder ve ödenmiş (PAID) tüm kayıtları iade eder (REFUNDED)."""
    s = await _get_session_or_404(db, session_id)
    if s.status == ExamSessionStatus.CANCELLED.value:
        return _session_out(s, registered_count=await _count_active(db, s.id))

    s.status = ExamSessionStatus.CANCELLED.value
    regs = (
        await db.execute(
            select(ExamRegistration).where(
                ExamRegistration.session_id == s.id,
                ExamRegistration.status == RegistrationStatus.PAID.value,
                ExamRegistration.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    provider = payments.get_payment_provider()
    for reg in regs:
        ok = await provider.refund(
            provider_ref=reg.provider_ref, amount=Decimal(str(reg.amount))
        )
        if ok:
            reg.status = RegistrationStatus.REFUNDED.value
            reg.refunded_at = _now()
            await notification_service.notify(
                db,
                user_id=reg.client_id,
                role_id=ROLE_IDS[RoleType.CLIENT],
                message=f"'{s.title}' oturumu iptal edildi; ödemen iade edildi.",
                link="/biletlerim",
            )
    await db.commit()
    await db.refresh(s)
    return _session_out(s, registered_count=0)


async def list_public_sessions(
    db: AsyncSession, library_id: int, *, client_id: int | None = None
) -> list[ExamSessionOut]:
    """Bir kütüphanenin yaklaşan (gelecek) planlı oturumları — public profil için."""
    stmt = (
        select(LibraryExamSession)
        .where(
            LibraryExamSession.library_id == library_id,
            LibraryExamSession.deleted_at.is_(None),
            LibraryExamSession.status == ExamSessionStatus.SCHEDULED.value,
            LibraryExamSession.starts_at >= _now(),
        )
        .order_by(LibraryExamSession.starts_at.asc())
    )
    sessions = (await db.execute(stmt)).scalars().all()
    return await _attach_counts_and_mine(db, sessions, client_id=client_id)


async def list_library_sessions_admin(
    db: AsyncSession, library_id: int
) -> list[ExamSessionOut]:
    """Bir kütüphanenin tüm oturumları (geçmiş/iptal dahil) — admin/operatör için."""
    stmt = (
        select(LibraryExamSession)
        .where(
            LibraryExamSession.library_id == library_id,
            LibraryExamSession.deleted_at.is_(None),
        )
        .order_by(LibraryExamSession.starts_at.desc())
    )
    sessions = (await db.execute(stmt)).scalars().all()
    return await _attach_counts_and_mine(db, sessions, client_id=None)


async def _attach_counts_and_mine(
    db: AsyncSession,
    sessions: list[LibraryExamSession],
    *,
    client_id: int | None,
) -> list[ExamSessionOut]:
    if not sessions:
        return []
    ids = [s.id for s in sessions]
    lib_ids = {s.library_id for s in sessions}

    # Aktif kayıt sayıları (tek sorgu).
    count_rows = (
        await db.execute(
            select(ExamRegistration.session_id, func.count())
            .where(
                ExamRegistration.session_id.in_(ids),
                ExamRegistration.status.in_(ACTIVE_REGISTRATION_STATUSES),
                ExamRegistration.deleted_at.is_(None),
            )
            .group_by(ExamRegistration.session_id)
        )
    ).all()
    counts = {sid: c for sid, c in count_rows}

    libs = {
        lib.id: lib
        for lib in (
            await db.execute(select(Library).where(Library.id.in_(lib_ids)))
        ).scalars().all()
    }

    mine: dict[int, ExamRegistration] = {}
    if client_id is not None:
        my_rows = (
            await db.execute(
                select(ExamRegistration).where(
                    ExamRegistration.session_id.in_(ids),
                    ExamRegistration.client_id == client_id,
                    ExamRegistration.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        mine = {r.session_id: r for r in my_rows}

    out: list[ExamSessionOut] = []
    for s in sessions:
        lib = libs.get(s.library_id)
        reg = mine.get(s.id)
        out.append(
            _session_out(
                s,
                registered_count=int(counts.get(s.id, 0)),
                library_name=lib.name if lib else None,
                library_slug=lib.slug if lib else None,
                my_status=reg.status if reg else None,
                my_registration_id=reg.id if reg else None,
            )
        )
    return out


# ── Öğrenci kaydı + ödeme ────────────────────────────────────────────────────────


def _reg_out(reg: ExamRegistration, *, session: ExamSessionOut | None = None) -> RegistrationOut:
    out = RegistrationOut.model_validate(reg)
    out.amount = str(reg.amount)
    # QR + kısa kod yalnız ödenmiş (PAID) kayıtta paylaşılır.
    if reg.status != RegistrationStatus.PAID.value:
        out.qr_token = None
        out.short_code = None
    out.session = session
    return out


async def register(
    db: AsyncSession, client: Client, session_id: int
) -> RegistrationOut:
    s = await _get_session_or_404(db, session_id)
    if s.status != ExamSessionStatus.SCHEDULED.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu oturum kayda kapalı")
    if s.starts_at < _now():
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu oturumun tarihi geçmiş")

    existing = (
        await db.execute(
            select(ExamRegistration).where(
                ExamRegistration.session_id == session_id,
                ExamRegistration.client_id == client.id,
                ExamRegistration.deleted_at.is_(None),
            )
        )
    ).scalars().first()
    if existing is not None:
        if existing.status == RegistrationStatus.CANCELLED.value:
            # İptal edilmiş kaydı yeniden canlandır (ödeme bekleyen hale getir).
            existing.status = RegistrationStatus.PENDING_PAYMENT.value
            await db.commit()
            await db.refresh(existing)
            return _reg_out(existing)
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu oturuma zaten kayıtlısın")

    active = await _count_active(db, session_id)
    if active >= s.capacity:
        raise HTTPException(status.HTTP_409_CONFLICT, "Oturum kontenjanı dolu")

    amount = Decimal(str(s.price))
    commission, earning = _split(amount)
    reg = ExamRegistration(
        session_id=session_id,
        client_id=client.id,
        status=RegistrationStatus.PENDING_PAYMENT.value,
        amount=amount,
        commission_amount=commission,
        library_earning=earning,
        commission_rate=Decimal(str(settings.PLATFORM_COMMISSION_RATE)),
        currency=s.currency,
    )
    db.add(reg)
    await db.commit()
    await db.refresh(reg)
    return _reg_out(reg)


async def pay(
    db: AsyncSession, client: Client, registration_id: int
) -> tuple[RegistrationOut, str | None]:
    reg = await db.get(ExamRegistration, registration_id)
    if reg is None or reg.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kayıt bulunamadı")
    if reg.client_id != client.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sizin kaydınız değil")
    if reg.status in (RegistrationStatus.PAID.value, RegistrationStatus.ATTENDED.value):
        return _reg_out(reg), None  # zaten ödenmiş
    if reg.status != RegistrationStatus.PENDING_PAYMENT.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu kayıt için ödeme yapılamaz")

    s = await _get_session_or_404(db, reg.session_id)
    if s.status != ExamSessionStatus.SCHEDULED.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Oturum kayda kapalı")

    # Ücretsiz oturum (price=0): doğrudan PAID, sağlayıcı çağrısı yok.
    provider = payments.get_payment_provider()
    provider_ref: str | None = None
    if Decimal(str(reg.amount)) > 0:
        result = await provider.charge(
            amount=Decimal(str(reg.amount)),
            currency=reg.currency,
            booking_id=reg.id,  # sağlayıcı için tanımlayıcı (description'da kullanılır)
            description=f"Deneme Sinavi #{reg.id}",
        )
        if result.redirect_url:
            reg.provider = provider.name
            reg.provider_ref = result.provider_ref
            await db.commit()
            await db.refresh(reg)
            return _reg_out(reg), result.redirect_url
        if not result.success:
            await db.commit()
            raise HTTPException(
                status.HTTP_402_PAYMENT_REQUIRED, result.error or "Ödeme başarısız"
            )
        provider_ref = result.provider_ref

    reg.status = RegistrationStatus.PAID.value
    reg.provider = provider.name
    reg.provider_ref = provider_ref
    reg.paid_at = _now()
    reg.qr_token = secrets.token_urlsafe(24)
    reg.short_code = await _unique_short_code(db)
    await db.commit()
    await db.refresh(reg)
    return _reg_out(reg), None


async def cancel_registration(
    db: AsyncSession, client: Client, registration_id: int
) -> None:
    reg = await db.get(ExamRegistration, registration_id)
    if reg is None or reg.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kayıt bulunamadı")
    if reg.client_id != client.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sizin kaydınız değil")
    # Ödeme öncesi iptal serbest; ödenmişse no-show iadesi yok → iptal edilemez.
    if reg.status != RegistrationStatus.PENDING_PAYMENT.value:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Ödenmiş kayıt iptal edilemez (iade yok). Yalnız ödeme öncesi iptal edilebilir.",
        )
    reg.status = RegistrationStatus.CANCELLED.value
    await db.commit()


async def list_my_registrations(
    db: AsyncSession, client: Client
) -> list[RegistrationOut]:
    rows = (
        await db.execute(
            select(ExamRegistration)
            .options(selectinload(ExamRegistration.session))
            .where(
                ExamRegistration.client_id == client.id,
                ExamRegistration.deleted_at.is_(None),
                ExamRegistration.status != RegistrationStatus.CANCELLED.value,
            )
            .order_by(ExamRegistration.created_at.desc())
        )
    ).scalars().all()

    lib_ids = {r.session.library_id for r in rows if r.session}
    libs = {
        lib.id: lib
        for lib in (
            await db.execute(select(Library).where(Library.id.in_(lib_ids)))
        ).scalars().all()
    } if lib_ids else {}

    out: list[RegistrationOut] = []
    for r in rows:
        sess_out = None
        if r.session:
            lib = libs.get(r.session.library_id)
            sess_out = _session_out(
                r.session,
                registered_count=0,
                library_name=lib.name if lib else None,
                library_slug=lib.slug if lib else None,
            )
        out.append(_reg_out(r, session=sess_out))
    return out


# ── Operatör: katılımcı listesi + QR doğrulama ───────────────────────────────────


async def roster(db: AsyncSession, session_id: int) -> list[dict]:
    """Operatör/admin için oturum katılımcı listesi (ödeyenler + katılanlar)."""
    rows = (
        await db.execute(
            select(ExamRegistration, Client)
            .join(Client, Client.id == ExamRegistration.client_id)
            .where(
                ExamRegistration.session_id == session_id,
                ExamRegistration.status.in_(ACTIVE_REGISTRATION_STATUSES),
                ExamRegistration.deleted_at.is_(None),
            )
            .order_by(ExamRegistration.status.desc(), ExamRegistration.created_at.asc())
        )
    ).all()
    return [
        {
            "registration_id": reg.id,
            "client_name": client.full_name,
            "status": reg.status,
            "attended_at": reg.attended_at,
        }
        for reg, client in rows
    ]


async def verify_attendance(
    db: AsyncSession, *, operator_library_id: int, operator_id: int, payload: str
) -> AttendanceResult:
    """Operatör QR okutur → katılımı doğrula, escrow'u kütüphaneye serbest bırak.

    ``payload`` "{registration_id}:{token}" veya salt token olabilir. Operatör yalnız
    kendi kütüphanesinin oturumlarındaki kayıtları doğrulayabilir.
    """
    token = parse_qr_token(payload)
    code = normalize_code(payload)  # QR okutulamazsa elle girilen kısa kod

    reg = (
        await db.execute(
            select(ExamRegistration)
            .options(selectinload(ExamRegistration.session))
            .where(
                or_(
                    ExamRegistration.qr_token == token,
                    ExamRegistration.short_code == code,
                ),
                ExamRegistration.deleted_at.is_(None),
            )
        )
    ).scalars().first()
    if reg is None or reg.session is None:
        # Deneme bileti değil → çalışma alanı rezervasyonu QR'ı olabilir (birleşik doğrulama).
        from services import study_reservation_service

        study_result = await study_reservation_service.verify_attendance(
            db,
            operator_library_id=operator_library_id,
            operator_id=operator_id,
            token=token,
            code=code,
        )
        if study_result is not None:
            return study_result
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Geçersiz QR / bilet bulunamadı")

    return await _attend_exam(
        db, reg, operator_library_id=operator_library_id, operator_id=operator_id
    )


async def verify_by_registration(
    db: AsyncSession, *, operator_library_id: int, operator_id: int, registration_id: int
) -> AttendanceResult:
    """Operatör katılımcı listesinden seçip doğrular (QR/kod olmadan). Aynı scope +
    escrow-release mantığını QR yolu ile paylaşır."""
    reg = (
        await db.execute(
            select(ExamRegistration)
            .options(selectinload(ExamRegistration.session))
            .where(
                ExamRegistration.id == registration_id,
                ExamRegistration.deleted_at.is_(None),
            )
        )
    ).scalars().first()
    if reg is None or reg.session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kayıt bulunamadı")
    return await _attend_exam(
        db, reg, operator_library_id=operator_library_id, operator_id=operator_id
    )


async def _attend_exam(
    db: AsyncSession,
    reg: ExamRegistration,
    *,
    operator_library_id: int,
    operator_id: int,
) -> AttendanceResult:
    """Yüklenmiş bir kayıt için katılımı işaretler + emaneti serbest bırakır (RELEASED).
    QR/kod ve listeden-seç yollarının paylaştığı çekirdek."""
    if reg.session.library_id != operator_library_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Bu bilet sizin kütüphanenize ait değil"
        )

    client = await db.get(Client, reg.client_id)
    client_name = client.full_name if client else "Öğrenci"

    if reg.status == RegistrationStatus.ATTENDED.value:
        return AttendanceResult(
            registration_id=reg.id,
            client_name=client_name,
            exam_title=reg.session.title,
            status=reg.status,
            already=True,
            message="Bu katılımcı zaten doğrulanmıştı.",
        )
    if reg.status != RegistrationStatus.PAID.value:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Bu kayıt ödenmemiş; katılım doğrulanamaz"
        )

    reg.status = RegistrationStatus.ATTENDED.value
    reg.attended_at = _now()
    reg.attended_by_operator_id = operator_id
    reg.released_at = _now()
    await notification_service.notify(
        db,
        user_id=reg.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message=f"'{reg.session.title}' oturumuna katılımın doğrulandı.",
        link="/biletlerim",
    )
    await db.commit()
    return AttendanceResult(
        registration_id=reg.id,
        client_name=client_name,
        exam_title=reg.session.title,
        status=reg.status,
        already=False,
        message="Katılım doğrulandı ✓",
    )
