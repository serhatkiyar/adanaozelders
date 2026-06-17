from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.admin import Admin
from models.client import Client, ClientEducation
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor, TutorEducation
from schemas.education import EducationCreate, EducationUpdate
from services import notification_service

# role_id -> (education model, owner FK attribute name)
_EDUCATION_MODELS: dict[int, tuple[type, str]] = {
    ROLE_IDS[RoleType.TUTOR]: (TutorEducation, "tutor_id"),
    ROLE_IDS[RoleType.CLIENT]: (ClientEducation, "client_id"),
}

# Diploma doğrulama durumları.
_NONE, _PENDING, _VERIFIED, _REJECTED = "NONE", "PENDING", "VERIFIED", "REJECTED"

# Yalnız TutorEducation'da bulunan alanlar — client create/update'inde ayıklanır.
_TUTOR_ONLY_FIELDS = ("document_type", "verification_code", "verification_tckn")


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _strip_tutor_only(role_id: int, data: dict) -> dict:
    """Client eğitimlerinde olmayan (tutor'a özel) alanları ayıkla."""
    if role_id != ROLE_IDS[RoleType.TUTOR]:
        for f in _TUTOR_ONLY_FIELDS:
            data.pop(f, None)
    return data


def _model_for(role_id: int) -> tuple[type, str]:
    entry = _EDUCATION_MODELS.get(role_id)
    if entry is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Education is not available for this role"
        )
    return entry


async def list_by(
    db: AsyncSession, *, role_id: int, owner_id: int
) -> list:
    model, fk = _model_for(role_id)
    stmt = (
        select(model)
        .where(getattr(model, fk) == owner_id, model.deleted_at.is_(None))
        .order_by(
            model.end_year.desc().nulls_first(),
            model.start_year.desc().nulls_last(),
            model.id.desc(),
        )
    )
    return list((await db.execute(stmt)).scalars().all())


async def list_own(db: AsyncSession, user: Tutor | Client) -> list:
    return await list_by(db, role_id=user.role_id, owner_id=user.id)


async def _get_owned_or_404(
    db: AsyncSession, user: Tutor | Client, education_id: int
):
    model, fk = _model_for(user.role_id)
    edu = await db.get(model, education_id)
    if (
        edu is None
        or edu.deleted_at is not None
        or getattr(edu, fk) != user.id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Education not found")
    return edu


async def create(
    db: AsyncSession, user: Tutor | Client, data: EducationCreate
):
    model, fk = _model_for(user.role_id)
    payload = _strip_tutor_only(user.role_id, data.model_dump())
    edu = model(**{fk: user.id}, **payload)
    # Barkod (veya ileride belge) verildiyse doğrulama kuyruğuna düşür.
    if isinstance(edu, TutorEducation):
        _sync_review_state(edu)
    db.add(edu)
    await db.flush()
    await db.refresh(edu)
    return edu


async def update(
    db: AsyncSession, user: Tutor | Client, education_id: int, data: EducationUpdate
):
    edu = await _get_owned_or_404(db, user, education_id)
    old_code = getattr(edu, "verification_code", None)
    fields = _strip_tutor_only(user.role_id, data.model_dump(exclude_unset=True))
    for field, value in fields.items():
        setattr(edu, field, value)
    # Yalnız barkod GERÇEKTEN değiştiyse doğrulama yeniden teyide alınır;
    # okul adı vb. düzenlemesi mevcut doğrulamayı bozmaz.
    if (
        isinstance(edu, TutorEducation)
        and "verification_code" in fields
        and edu.verification_code != old_code
    ):
        _sync_review_state(edu)
    await db.flush()
    await db.refresh(edu)
    return edu


async def delete(
    db: AsyncSession, user: Tutor | Client, education_id: int
) -> None:
    edu = await _get_owned_or_404(db, user, education_id)
    edu.deleted_at = datetime.datetime.now(datetime.timezone.utc)
    await db.flush()


def _sync_review_state(edu: TutorEducation) -> None:
    """Doğrulama materyali (barkod veya belge) varsa kaydı teyit-bekliyor (PENDING)
    durumuna alır ve önceki teyit izlerini temizler; hiç materyal yoksa NONE'a çeker."""
    has_material = bool(edu.verification_code) or bool(edu.document_url)
    edu.verification_status = _PENDING if has_material else _NONE
    edu.verified_at = None
    edu.verified_by = None
    edu.verification_note = None


async def set_document(
    db: AsyncSession,
    user: Tutor,
    education_id: int,
    *,
    url: str,
    document_name: str,
):
    """Eğitim kaydına diploma/belge URL'sini iliştirir (yalnız eğitmen).
    Yeni belge → doğrulama teyit-bekliyor (PENDING) durumuna geçer."""
    edu = await _get_owned_or_404(db, user, education_id)
    edu.document_url = url
    edu.document_name = document_name
    _sync_review_state(edu)
    await db.flush()
    await db.refresh(edu)
    return edu


async def has_document(db: AsyncSession, *, tutor_id: int) -> bool:
    """Eğitmenin en az bir eğitim kaydında belge var mı?"""
    stmt = (
        select(TutorEducation.id)
        .where(
            TutorEducation.tutor_id == tutor_id,
            TutorEducation.deleted_at.is_(None),
            TutorEducation.document_url.is_not(None),
        )
        .limit(1)
    )
    return (await db.execute(stmt)).first() is not None


async def has_verification_material(db: AsyncSession, *, tutor_id: int) -> bool:
    """Onay kapısı: eğitmenin en az bir eğitiminde doğrulama materyali (yüklenen
    belge VEYA e-Devlet barkodu) var mı? Barkod tek başına yeterli."""
    stmt = (
        select(TutorEducation.id)
        .where(
            TutorEducation.tutor_id == tutor_id,
            TutorEducation.deleted_at.is_(None),
            or_(
                TutorEducation.document_url.is_not(None),
                TutorEducation.verification_code.is_not(None),
            ),
        )
        .limit(1)
    )
    return (await db.execute(stmt)).first() is not None


async def has_verified_document(db: AsyncSession, *, tutor_id: int) -> bool:
    """Eğitmenin en az bir eğitiminde DOĞRULANMIŞ belge var mı? ("Diploması
    Doğrulandı" rozeti için)."""
    stmt = (
        select(TutorEducation.id)
        .where(
            TutorEducation.tutor_id == tutor_id,
            TutorEducation.deleted_at.is_(None),
            TutorEducation.verification_status == _VERIFIED,
        )
        .limit(1)
    )
    return (await db.execute(stmt)).first() is not None


# ── Admin: diploma doğrulama kuyruğu ──

async def admin_get_education_or_404(db: AsyncSession, education_id: int) -> TutorEducation:
    edu = await db.get(TutorEducation, education_id)
    if edu is None or edu.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Eğitim kaydı bulunamadı")
    return edu


async def admin_list_pending(db: AsyncSession) -> list[tuple[TutorEducation, Tutor]]:
    """Tüm eğitmenlerde teyit bekleyen (PENDING) eğitimler + sahip eğitmen.
    Materyal barkod veya belge olabilir (e-Devlet barkodu tek başına yeterli)."""
    stmt = (
        select(TutorEducation, Tutor)
        .join(Tutor, Tutor.id == TutorEducation.tutor_id)
        .where(
            TutorEducation.deleted_at.is_(None),
            TutorEducation.verification_status == _PENDING,
        )
        .order_by(TutorEducation.created_at.asc())
    )
    return [(e, t) for e, t in (await db.execute(stmt)).all()]


async def admin_set_verification(
    db: AsyncSession,
    education_id: int,
    admin: Admin,
    *,
    action: str,
    note: str | None = None,
) -> TutorEducation:
    """Admin bir diploma belgesini doğrular (VERIFIED) veya reddeder (REJECTED).
    Eğitmene bildirim gönderir. Audit kaydı çağıran router'da yazılır."""
    edu = await admin_get_education_or_404(db, education_id)
    if not edu.verification_code and edu.document_url is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Bu eğitime henüz barkod/belge eklenmemiş"
        )

    if action == "verify":
        edu.verification_status = _VERIFIED
        edu.verified_at = _now()
        edu.verified_by = admin.id
        edu.verification_note = None
        message = f"'{edu.school_name}' diploma belgen doğrulandı ✓"
    elif action == "reject":
        edu.verification_status = _REJECTED
        edu.verified_at = None
        edu.verified_by = admin.id
        edu.verification_note = note
        message = (
            f"'{edu.school_name}' diploma belgen reddedildi"
            + (f": {note}" if note else "")
        )
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Geçersiz işlem")

    await db.flush()
    await notification_service.notify(
        db,
        user_id=edu.tutor_id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message=message,
        link="/ilan-ayarlari",
    )
    await db.refresh(edu)
    return edu
