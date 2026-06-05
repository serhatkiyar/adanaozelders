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

from core import exam_results, payments, storage
from core.codes import gen_short_code, normalize_code
from core.config import settings
from models.client import Client
from models.library import Library, LibraryStatus
from models.library_exam import (
    ACTIVE_REGISTRATION_STATUSES,
    ExamRegistration,
    ExamSessionStatus,
    LibraryExamSession,
    RegistrationStatus,
)
from models.library_exam_catalog import LibraryExamCatalog
from models.role import ROLE_IDS, RoleType
from schemas.library_exam import (
    AttendanceResult,
    BulkDocumentOut,
    ExamSessionCreate,
    ExamSessionOut,
    ExamSessionUpdate,
    PublishResultsOut,
    RegistrationOut,
    ResultSummaryIn,
    RosterRow,
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
    catalog_name: str | None = None,
    is_nationwide: bool = False,
    catalog_answer_key_url: str | None = None,
    results_entered_count: int = 0,
) -> ExamSessionOut:
    published = s.results_published_at is not None
    # Cevap anahtarı yalnız sonuçlar yayınlandıktan sonra paylaşılır (önceden sızmasın).
    answer_key = (s.answer_key_url or catalog_answer_key_url) if published else None
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
        catalog_id=s.catalog_id,
        catalog_name=catalog_name,
        is_nationwide=is_nationwide,
        answer_key_url=answer_key,
        results_published=published,
        results_entered_count=results_entered_count,
    )


async def _get_session_or_404(db: AsyncSession, session_id: int) -> LibraryExamSession:
    s = await db.get(LibraryExamSession, session_id)
    if s is None or s.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Oturum bulunamadı")
    return s


# ── Oturum yönetimi (admin / operatör) ──────────────────────────────────────────


async def _validate_catalog(db: AsyncSession, catalog_id: int) -> LibraryExamCatalog:
    cat = await db.get(LibraryExamCatalog, catalog_id)
    if cat is None or cat.deleted_at is not None or not cat.is_public:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Katalog bulunamadı")
    return cat


async def _entered_count(db: AsyncSession, session_id: int) -> int:
    """Karnesi yüklenmiş kayıt sayısı (operatör ilerlemesi)."""
    return int(
        (
            await db.execute(
                select(func.count()).where(
                    ExamRegistration.session_id == session_id,
                    ExamRegistration.result_document_url.isnot(None),
                    ExamRegistration.deleted_at.is_(None),
                )
            )
        ).scalar_one()
    )


async def _enriched_session_out(
    db: AsyncSession,
    s: LibraryExamSession,
    *,
    registered_count: int,
    library_name: str | None = None,
    library_slug: str | None = None,
) -> ExamSessionOut:
    """Tek oturumu katalog + girilmiş sonuç sayısıyla zenginleştirip döndürür."""
    cat = await db.get(LibraryExamCatalog, s.catalog_id) if s.catalog_id else None
    return _session_out(
        s,
        registered_count=registered_count,
        library_name=library_name,
        library_slug=library_slug,
        catalog_name=cat.exam_name if cat else None,
        is_nationwide=bool(cat.is_nationwide) if cat else False,
        catalog_answer_key_url=cat.answer_key_url if cat else None,
        results_entered_count=await _entered_count(db, s.id),
    )


async def create_session(
    db: AsyncSession, library_id: int, payload: ExamSessionCreate
) -> ExamSessionOut:
    lib = await db.get(Library, library_id)
    if lib is None or lib.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kütüphane bulunamadı")
    # Yalnız onaylı (ACTIVE) kütüphane public deneme oturumu açabilir — PENDING/REJECTED
    # self-servis başvuru onay öncesi ücretli akış başlatamaz.
    if lib.status != LibraryStatus.ACTIVE.value:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Kütüphane henüz onaylı değil; deneme oturumu oluşturulamaz.",
        )
    if payload.catalog_id is not None:
        await _validate_catalog(db, payload.catalog_id)
    s = LibraryExamSession(
        library_id=library_id,
        catalog_id=payload.catalog_id,
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
    return await _enriched_session_out(
        db, s, registered_count=0, library_name=lib.name, library_slug=lib.slug
    )


async def update_session(
    db: AsyncSession, session_id: int, payload: ExamSessionUpdate
) -> ExamSessionOut:
    s = await _get_session_or_404(db, session_id)
    data = payload.model_dump(exclude_unset=True)
    if "catalog_id" in data:
        if data["catalog_id"] is not None:
            await _validate_catalog(db, data["catalog_id"])
        s.catalog_id = data["catalog_id"]
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
    return await _enriched_session_out(db, s, registered_count=active)


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
    # Savunma katmanı: yalnız onaylı (ACTIVE) kütüphanenin oturumları public görünür
    # (kütüphane sonradan gizlenir/reddedilirse oturumları da listelenmesin).
    lib = await db.get(Library, library_id)
    if lib is None or lib.status != LibraryStatus.ACTIVE.value:
        return []
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

    # Katalog bilgisi (ortak deneme adı/cevap anahtarı) — tek sorgu.
    cat_ids = {s.catalog_id for s in sessions if s.catalog_id is not None}
    cats = {
        c.id: c
        for c in (
            await db.execute(
                select(LibraryExamCatalog).where(LibraryExamCatalog.id.in_(cat_ids))
            )
        ).scalars().all()
    } if cat_ids else {}

    # Karne yüklenmiş kayıt sayıları (operatör ilerlemesi) — tek sorgu.
    entered_rows = (
        await db.execute(
            select(ExamRegistration.session_id, func.count())
            .where(
                ExamRegistration.session_id.in_(ids),
                ExamRegistration.result_document_url.isnot(None),
                ExamRegistration.deleted_at.is_(None),
            )
            .group_by(ExamRegistration.session_id)
        )
    ).all()
    entered = {sid: c for sid, c in entered_rows}

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
        cat = cats.get(s.catalog_id) if s.catalog_id else None
        out.append(
            _session_out(
                s,
                registered_count=int(counts.get(s.id, 0)),
                library_name=lib.name if lib else None,
                library_slug=lib.slug if lib else None,
                my_status=reg.status if reg else None,
                my_registration_id=reg.id if reg else None,
                catalog_name=cat.exam_name if cat else None,
                is_nationwide=bool(cat.is_nationwide) if cat else False,
                catalog_answer_key_url=cat.answer_key_url if cat else None,
                results_entered_count=int(entered.get(s.id, 0)),
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
    # Sınav sonucu (karne + opsiyonel net/sıralama) yalnız oturum yayınlandıysa döner.
    published = bool(session and session.results_published)
    out.result_published = published
    if not published:
        out.result_document_url = None
        out.result_net = None
        out.result_rank = None
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


# Ödenmiş kayıt iptalinde tam iade için pencere: oturum başlangıcına bu kadar saatten
# FAZLA varsa öğrenci iptal edip tam iade alır; daha az kalırsa iade yok (no-show riski).
REFUND_WINDOW_HOURS = 24


async def cancel_registration(
    db: AsyncSession, client: Client, registration_id: int
) -> None:
    reg = await db.get(ExamRegistration, registration_id)
    if reg is None or reg.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kayıt bulunamadı")
    if reg.client_id != client.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sizin kaydınız değil")

    # Ödeme öncesi iptal her zaman serbest.
    if reg.status == RegistrationStatus.PENDING_PAYMENT.value:
        reg.status = RegistrationStatus.CANCELLED.value
        await db.commit()
        return

    # Ödenmiş kayıt: başlangıca REFUND_WINDOW_HOURS saatten fazla varsa TAM iade.
    if reg.status == RegistrationStatus.PAID.value:
        session = await db.get(LibraryExamSession, reg.session_id)
        if session is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Oturum bulunamadı")
        if _now() > session.starts_at - datetime.timedelta(hours=REFUND_WINDOW_HOURS):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Oturuma {REFUND_WINDOW_HOURS} saatten az kaldı; iade yapılamaz.",
            )
        refunded = True
        if Decimal(str(reg.amount)) > 0:
            provider = payments.get_payment_provider()
            refunded = await provider.refund(
                provider_ref=reg.provider_ref, amount=Decimal(str(reg.amount))
            )
        if not refunded:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, "İade alınamadı; lütfen sonra tekrar dene."
            )
        reg.status = RegistrationStatus.REFUNDED.value
        reg.refunded_at = _now()
        await db.commit()
        return

    raise HTTPException(status.HTTP_409_CONFLICT, "Bu kayıt iptal edilemez.")


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

    cat_ids = {r.session.catalog_id for r in rows if r.session and r.session.catalog_id}
    cats = {
        c.id: c
        for c in (
            await db.execute(
                select(LibraryExamCatalog).where(LibraryExamCatalog.id.in_(cat_ids))
            )
        ).scalars().all()
    } if cat_ids else {}

    out: list[RegistrationOut] = []
    for r in rows:
        sess_out = None
        if r.session:
            lib = libs.get(r.session.library_id)
            cat = cats.get(r.session.catalog_id) if r.session.catalog_id else None
            sess_out = _session_out(
                r.session,
                registered_count=0,
                library_name=lib.name if lib else None,
                library_slug=lib.slug if lib else None,
                catalog_name=cat.exam_name if cat else None,
                is_nationwide=bool(cat.is_nationwide) if cat else False,
                catalog_answer_key_url=cat.answer_key_url if cat else None,
            )
        out.append(_reg_out(r, session=sess_out))
    return out


# ── Operatör: katılımcı listesi + QR doğrulama ───────────────────────────────────


async def auto_release_no_shows(db: AsyncSession) -> int:
    """Etkinliği bitmiş ama katılımı doğrulanmamış (no-show) ÖDENMİŞ kayıtlarda
    emaneti kütüphaneye serbest bırakır (``released_at``). No-show iadesi yoktur →
    para kütüphaneye geçer; aksi halde escrow'da süresiz kilitli kalırdı. ATTENDED
    olanlar zaten serbest; CANCELLED/REFUNDED hariç. Loop commit eder."""
    now = _now()
    grace = datetime.timedelta(hours=settings.AUTO_COMPLETE_GRACE_HOURS)
    rows = (
        await db.execute(
            select(ExamRegistration, LibraryExamSession)
            .join(LibraryExamSession, LibraryExamSession.id == ExamRegistration.session_id)
            .where(
                ExamRegistration.status == RegistrationStatus.PAID.value,
                ExamRegistration.released_at.is_(None),
                ExamRegistration.deleted_at.is_(None),
                LibraryExamSession.starts_at <= now,
            )
        )
    ).all()
    count = 0
    for reg, sess in rows:
        end = sess.starts_at + datetime.timedelta(minutes=sess.duration_minutes)
        if end + grace <= now:
            reg.released_at = now
            count += 1
    return count


async def roster(db: AsyncSession, session_id: int) -> list[RosterRow]:
    """Operatör/admin için oturum katılımcı + sonuç tablosu (ödeyenler + katılanlar)."""
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
    return [_roster_row(reg, client.full_name) for reg, client in rows]


# ── Sonuç (karne) girişi + yayınlama (operatör / admin) ──────────────────────────


def _roster_row(reg: ExamRegistration, client_name: str) -> RosterRow:
    return RosterRow(
        registration_id=reg.id,
        client_name=client_name,
        status=reg.status,
        attended_at=reg.attended_at,
        result_document_url=reg.result_document_url,
        result_net=str(reg.result_net) if reg.result_net is not None else None,
        result_rank=reg.result_rank,
    )


async def _require_reg_in_session(
    db: AsyncSession, session_id: int, registration_id: int
) -> ExamRegistration:
    reg = await db.get(ExamRegistration, registration_id)
    if (
        reg is None
        or reg.deleted_at is not None
        or reg.session_id != session_id
        or reg.status not in ACTIVE_REGISTRATION_STATUSES
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kayıt bu oturumda bulunamadı")
    return reg


def _stamp_entry(reg: ExamRegistration, *, user_id: int, role_id: int) -> None:
    reg.results_entered_by_user_id = user_id
    reg.results_entered_by_role_id = role_id
    reg.results_entered_at = _now()


async def set_result_summary(
    db: AsyncSession,
    session_id: int,
    registration_id: int,
    payload: ResultSummaryIn,
    *,
    user_id: int,
    role_id: int,
) -> RosterRow:
    """Opsiyonel hızlı özet: toplam net + sıralama (karne başlığından). Net girişi
    DEĞİL — asıl sonuç karne PDF'idir; bu yalnız listede özet göstermek içindir."""
    await _get_session_or_404(db, session_id)
    reg = await _require_reg_in_session(db, session_id, registration_id)
    reg.result_net = (
        Decimal(str(payload.net)).quantize(Decimal("0.01"))
        if payload.net is not None
        else None
    )
    reg.result_rank = payload.rank
    _stamp_entry(reg, user_id=user_id, role_id=role_id)
    await db.commit()
    client = await db.get(Client, reg.client_id)
    return _roster_row(reg, client.full_name if client else "Öğrenci")


async def set_result_document(
    db: AsyncSession,
    session_id: int,
    registration_id: int,
    *,
    file_bytes: bytes,
    original_name: str | None,
    content_type: str | None,
    user_id: int,
    role_id: int,
) -> RosterRow:
    """Bir katılımcının taranmış bireysel karnesini (PDF/görsel) yükler — BİRİNCİL sonuç."""
    await _get_session_or_404(db, session_id)
    reg = await _require_reg_in_session(db, session_id, registration_id)
    old = reg.result_document_url
    reg.result_document_url = await storage.upload_file(
        file_bytes, original_name=original_name, content_type=content_type
    )
    _stamp_entry(reg, user_id=user_id, role_id=role_id)
    await db.commit()
    if old:
        await storage.delete_file(old)
    client = await db.get(Client, reg.client_id)
    return _roster_row(reg, client.full_name if client else "Öğrenci")


async def bulk_upload_documents(
    db: AsyncSession,
    session_id: int,
    files: list[tuple[str | None, str | None, bytes]],
    *,
    user_id: int,
    role_id: int,
) -> BulkDocumentOut:
    """Toplu karne yükleme: her dosya adının başındaki registration_id ile eşlenir
    (operatör referans listesine göre adlandırır). ``files`` = (ad, content_type, bytes)."""
    # Bu oturuma ait aktif kayıt id'leri (yabancı/yanlış eşlemeleri ele).
    valid_ids = {
        rid
        for (rid,) in (
            await db.execute(
                select(ExamRegistration.id).where(
                    ExamRegistration.session_id == session_id,
                    ExamRegistration.status.in_(ACTIVE_REGISTRATION_STATUSES),
                    ExamRegistration.deleted_at.is_(None),
                )
            )
        ).all()
    }
    matched = 0
    skipped = 0
    errors: list[str] = []
    for name, content_type, blob in files:
        reg_id = exam_results.parse_registration_id(name)
        if reg_id is None or reg_id not in valid_ids:
            skipped += 1
            errors.append(
                f"'{name or 'dosya'}' eşlenemedi (ad başına kayıt no koyun)"
            )
            continue
        reg = await db.get(ExamRegistration, reg_id)
        old = reg.result_document_url
        reg.result_document_url = await storage.upload_file(
            blob, original_name=name, content_type=content_type
        )
        _stamp_entry(reg, user_id=user_id, role_id=role_id)
        if old:
            await storage.delete_file(old)
        matched += 1
    await db.commit()
    return BulkDocumentOut(matched=matched, skipped=skipped, errors=errors)


async def publish_results(db: AsyncSession, session_id: int) -> PublishResultsOut:
    """Oturum sonuçlarını öğrencilere açar: ``results_published_at`` damgalanır ve
    karnesi olan her öğrenciye bildirim gider. İlk yayında bildirim atılır; tekrar
    çağrılırsa sessizdir (spam yok). (Konu-bazında in-app analiz Faz B.)"""
    s = await _get_session_or_404(db, session_id)
    first_publish = s.results_published_at is None
    if first_publish:
        s.results_published_at = _now()

    regs = (
        await db.execute(
            select(ExamRegistration).where(
                ExamRegistration.session_id == session_id,
                ExamRegistration.result_document_url.isnot(None),
                ExamRegistration.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    count = 0
    for reg in regs:
        if first_publish:
            await notification_service.notify(
                db,
                user_id=reg.client_id,
                role_id=ROLE_IDS[RoleType.CLIENT],
                message=f"'{s.title}' deneme sınavı karnen açıklandı.",
                link="/biletlerim",
            )
        count += 1
    await db.commit()
    return PublishResultsOut(
        published_count=count,
        message=(
            f"Sonuçlar yayınlandı ({count} karne)."
            if first_publish
            else "Sonuçlar zaten yayında."
        ),
    )


async def set_session_answer_key(
    db: AsyncSession,
    session_id: int,
    *,
    file_bytes: bytes,
    original_name: str | None,
    content_type: str | None,
) -> ExamSessionOut:
    """Oturuma özel cevap anahtarı yükler (katalogsuz oturumlar için)."""
    s = await _get_session_or_404(db, session_id)
    old = s.answer_key_url
    s.answer_key_url = await storage.upload_file(
        file_bytes, original_name=original_name, content_type=content_type
    )
    await db.commit()
    await db.refresh(s)
    if old:
        await storage.delete_file(old)
    return await _enriched_session_out(
        db, s, registered_count=await _count_active(db, s.id)
    )


def results_reference_csv(roster_rows: list[RosterRow]) -> str:
    """Toplu karne yükleme için referans listesi: registration_id + öğrenci adı.
    Operatör her karne PDF'ini ilgili ``registration_id`` ile adlandırır (ör.
    "123 - Ali Veli.pdf") → toplu yüklemede otomatik eşlenir."""
    import csv as _csv
    import io as _io

    buf = _io.StringIO()
    w = _csv.writer(buf)
    w.writerow(["registration_id", "client_name"])
    for r in roster_rows:
        w.writerow([r.registration_id, r.client_name])
    return buf.getvalue()


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
    # Karma puanlama: bu öğrenci daha önce bu kütüphaneye yorum yazdıysa artık yıldız
    # ortalamasına katsın (best-effort — promotion katılım doğrulamayı asla bozmamalı).
    try:
        from services import library_service

        await library_service.promote_reviews_for_visitor(
            db, reg.session.library_id, reg.client_id
        )
    except Exception:  # noqa: BLE001
        await db.rollback()
    return AttendanceResult(
        registration_id=reg.id,
        client_name=client_name,
        exam_title=reg.session.title,
        status=reg.status,
        already=False,
        message="Katılım doğrulandı ✓",
    )
