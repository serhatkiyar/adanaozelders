from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor, TutorAvailability, TutorStatus, TutorSubject
from schemas.tutor import TutorProfileUpdate
from services import education_service, notification_service

_MAX_SUBJECTS = 40
_MAX_AVAILABILITY = 60


async def attach_subjects(db: AsyncSession, tutor: Tutor) -> Tutor:
    """Eğitmenin ders kümesini list[str] olarak `tutor.subjects`'a koyar (serileştirme için)."""
    rows = await db.execute(
        select(TutorSubject.subject)
        .where(TutorSubject.tutor_id == tutor.id)
        .order_by(TutorSubject.subject)
    )
    tutor.subjects = [r[0] for r in rows.all()]
    return tutor


async def _replace_subjects(
    db: AsyncSession, tutor: Tutor, subjects: list[str]
) -> None:
    clean: list[str] = []
    seen: set[str] = set()
    for raw in subjects:
        s = raw.strip()
        if s and s not in seen and len(s) <= 100:
            seen.add(s)
            clean.append(s)
        if len(clean) >= _MAX_SUBJECTS:
            break
    await db.execute(delete(TutorSubject).where(TutorSubject.tutor_id == tutor.id))
    for s in clean:
        db.add(TutorSubject(tutor_id=tutor.id, subject=s))
    await db.flush()


async def attach_availability(db: AsyncSession, tutor: Tutor) -> Tutor:
    rows = (
        await db.execute(
            select(TutorAvailability)
            .where(TutorAvailability.tutor_id == tutor.id)
            .order_by(TutorAvailability.weekday, TutorAvailability.start_minute)
        )
    ).scalars().all()
    tutor.availability = list(rows)
    return tutor


async def _replace_availability(
    db: AsyncSession, tutor: Tutor, items: list[dict]
) -> None:
    await db.execute(
        delete(TutorAvailability).where(TutorAvailability.tutor_id == tutor.id)
    )
    for it in items[:_MAX_AVAILABILITY]:
        db.add(
            TutorAvailability(
                tutor_id=tutor.id,
                weekday=it["weekday"],
                start_minute=it["start_minute"],
                end_minute=it["end_minute"],
            )
        )
    await db.flush()

_TRANSITIONS: dict[TutorStatus, set[TutorStatus]] = {
    TutorStatus.DRAFT: {TutorStatus.PENDING_APPROVAL},
    TutorStatus.PENDING_APPROVAL: {TutorStatus.APPROVED, TutorStatus.REJECTED},
    TutorStatus.REJECTED: {TutorStatus.PENDING_APPROVAL},
    TutorStatus.APPROVED: {TutorStatus.SUSPENDED},
    TutorStatus.SUSPENDED: {TutorStatus.APPROVED},
}

# Profil her durumda düzenlenebilir; yalnızca onay sürecindeyken (PENDING_APPROVAL) kilitli.
_EDITABLE_STATES = {
    TutorStatus.DRAFT,
    TutorStatus.REJECTED,
    TutorStatus.APPROVED,
    TutorStatus.SUSPENDED,
}


def _transition(tutor: Tutor, target: TutorStatus) -> None:
    if target not in _TRANSITIONS.get(tutor.status, set()):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Invalid transition: {tutor.status.value} -> {target.value}",
        )
    tutor.status = target


async def update_profile(
    db: AsyncSession, tutor: Tutor, data: TutorProfileUpdate
) -> Tutor:
    if tutor.status not in _EDITABLE_STATES:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Profile editable only in DRAFT or REJECTED state",
        )
    payload = data.model_dump(exclude_unset=True)
    subjects = payload.pop("subjects", None)
    availability = payload.pop("availability", None)
    for field, value in payload.items():
        setattr(tutor, field, value)
    if subjects is not None:
        await _replace_subjects(db, tutor, subjects)
    if availability is not None:
        await _replace_availability(db, tutor, availability)
    await db.flush()
    await attach_subjects(db, tutor)
    await attach_availability(db, tutor)
    return tutor


async def submit_for_approval(db: AsyncSession, tutor: Tutor) -> Tutor:
    # Zorunlu kalite kapısı: en az bir eğitim kaydında doğrulama materyali
    # (yüklenen diploma/belge VEYA e-Devlet barkodu) olmadan onaya gönderilemez.
    if not await education_service.has_verification_material(db, tutor_id=tutor.id):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Onaya göndermeden önce eğitim bilgilerinden en az birine diploma/belge "
            "yükle ya da e-Devlet doğrulama barkodunu gir. (Profil → Eğitim)",
        )
    _transition(tutor, TutorStatus.PENDING_APPROVAL)
    await db.flush()
    return tutor


async def approve(db: AsyncSession, tutor: Tutor) -> Tutor:
    _transition(tutor, TutorStatus.APPROVED)
    await db.flush()
    await notification_service.notify(
        db,
        user_id=tutor.id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message="İlanın onaylandı ve artık yayında!",
        link="/tutor/settings",
    )
    return tutor


async def reject(db: AsyncSession, tutor: Tutor) -> Tutor:
    _transition(tutor, TutorStatus.REJECTED)
    await db.flush()
    await notification_service.notify(
        db,
        user_id=tutor.id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message="İlanın reddedildi. Bilgilerini güncelleyip tekrar gönderebilirsin.",
        link="/tutor/settings",
    )
    return tutor


async def suspend(db: AsyncSession, tutor: Tutor) -> Tutor:
    # Eğitmenin self-servis "Pasife al" aksiyonu; yalnızca yayındaki ilan pasife alınabilir.
    if tutor.status != TutorStatus.APPROVED:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Only an approved listing can be suspended"
        )
    _transition(tutor, TutorStatus.SUSPENDED)
    await db.flush()
    return tutor


async def activate(db: AsyncSession, tutor: Tutor) -> Tutor:
    # Eğitmenin self-servis "Aktifleştir" aksiyonu; yalnızca pasif ilan yeniden yayına alınabilir.
    if tutor.status != TutorStatus.SUSPENDED:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Only a suspended listing can be reactivated"
        )
    _transition(tutor, TutorStatus.APPROVED)
    await db.flush()
    return tutor
