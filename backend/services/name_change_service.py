"""Ad-soyad / kullanıcı adı değişiklik kuralı + admin onay kuyruğu.

Kimlik bütünlüğü için bu alanlar serbestçe değiştirilemez:
- İlk değişiklik doğrudan uygulanır (sayaç artar).
- İkinci ve sonraki değişiklikler doğrudan uygulanmaz; gerekçeyle birlikte PENDING
  talep olarak kaydedilir ve admin onaylayınca uygulanır.
"""
from __future__ import annotations

from core import frontend_yollari

import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.admin import Admin
from models.client import Client
from models.library_operator import LibraryOperator
from models.name_change_request import NameChangeRequest
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor, TutorStatus
from services import notification_service

# role_id -> kullanıcı modeli (ayrı tablolar; FK yok).
_ROLE_MODELS: dict[int, type] = {
    ROLE_IDS[RoleType.ADMIN]: Admin,
    ROLE_IDS[RoleType.TUTOR]: Tutor,
    ROLE_IDS[RoleType.CLIENT]: Client,
    ROLE_IDS[RoleType.LIBRARY_OPERATOR]: LibraryOperator,
}


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


# Eğitmen onaylandıktan (veya askıya alındıktan, ki o da onaydan geçmiştir) sonra
# kimliği admin tarafından teyit edilmiş sayılır.
_TUTOR_IDENTITY_LOCKED = {TutorStatus.APPROVED, TutorStatus.SUSPENDED}


def _name_change_needs_approval(user, role_id: int) -> bool:
    """Ad-soyad değişiminin doğrudan mı uygulanacağı yoksa admin onayına mı
    gideceğine role/duruma göre karar verir.

    - TUTOR: kimliği admin onayından geçtiyse (APPROVED/SUSPENDED) HER değişim onaya;
      onaydan önce (DRAFT/PENDING_APPROVAL/REJECTED) serbest düzeltme.
    - LIBRARY_OPERATOR: admin tarafından oluşturulan kimliğe bağlı — HER değişim onaya.
    - CLIENT / ADMIN: ilk değişim serbest, sonrası onay (sayaç tabanlı).
    """
    if role_id == ROLE_IDS[RoleType.TUTOR]:
        return getattr(user, "status", None) in _TUTOR_IDENTITY_LOCKED
    if role_id == ROLE_IDS[RoleType.LIBRARY_OPERATOR]:
        return True
    return user.name_change_count > 0


def annotate_change_locks(user, role_id: int) -> None:
    """Kullanıcı modeline, ad-soyad/kullanıcı adının bir sonraki değişiminin admin
    onayı gerektirip gerektirmediğini transient bayrak olarak işler (UserOut için).
    Kural tek kaynak: ``_name_change_needs_approval``."""
    user.name_change_locked = _name_change_needs_approval(user, role_id)
    # Kullanıcı adı için kural sayaç-tabanlı kalır (kimlik-kritik değil): ilk serbest.


async def _require_no_pending(
    db: AsyncSession, user_id: int, role_id: int, kind: str
) -> None:
    stmt = select(NameChangeRequest.id).where(
        NameChangeRequest.user_id == user_id,
        NameChangeRequest.role_id == role_id,
        NameChangeRequest.kind == kind,
        NameChangeRequest.status == "PENDING",
    )
    if (await db.execute(stmt)).first() is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Bu alan için zaten admin onayı bekleyen bir talebin var.",
        )


async def apply_or_request(
    db: AsyncSession,
    user,
    *,
    role_id: int,
    first_name: str | None,
    last_name: str | None,
    reason: str | None,
) -> dict[str, list[str]]:
    """Ad-soyad değişikliğini işler.

    İlk değişiklik doğrudan uygulanır; sonrası gerekçeyle PENDING talebe dönüşür.
    ``{"applied": [...], "pending": [...]}`` döner (tek alan adı: NAME).

    KULLANICI ADI DALI 5 Eyl 2026'da KALDIRILDI: alan sistemde iş yapmıyordu
    (giriş e-posta ile, profil URL'i id/slug ile) ama üstünde tam bir admin
    onay kuyruğu vardı. Nöbetçi: `tests/test_kullanici_adi_kaldirildi.py`.
    """
    applied: list[str] = []
    pending: list[str] = []

    name_changed = (
        first_name is not None and first_name != user.first_name
    ) or (last_name is not None and last_name != user.last_name)
    if name_changed:
        new_first = first_name if first_name is not None else user.first_name
        new_last = last_name if last_name is not None else user.last_name
        if not _name_change_needs_approval(user, role_id):
            user.first_name = new_first
            user.last_name = new_last
            user.name_change_count += 1
            applied.append("NAME")
        else:
            if not reason or not reason.strip():
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    "Ad-soyad değişikliği için bir gerekçe yazmalısın.",
                )
            await _require_no_pending(db, user.id, role_id, "NAME")
            db.add(
                NameChangeRequest(
                    user_id=user.id,
                    role_id=role_id,
                    kind="NAME",
                    new_first_name=new_first,
                    new_last_name=new_last,
                    reason=reason.strip(),
                )
            )
            pending.append("NAME")

    await db.flush()
    return {"applied": applied, "pending": pending}


async def list_for_user(
    db: AsyncSession, *, user_id: int, role_id: int
) -> list[NameChangeRequest]:
    """Kullanıcının kendi talepleri (en yeni önce)."""
    stmt = (
        select(NameChangeRequest)
        .where(
            NameChangeRequest.user_id == user_id,
            NameChangeRequest.role_id == role_id,
        )
        .order_by(NameChangeRequest.created_at.desc())
    )
    return list((await db.execute(stmt)).scalars().all())


async def list_admin(
    db: AsyncSession, *, status_filter: str | None = None, limit: int = 100
) -> list[NameChangeRequest]:
    stmt = select(NameChangeRequest)
    if status_filter:
        stmt = stmt.where(NameChangeRequest.status == status_filter)
    stmt = stmt.order_by(NameChangeRequest.created_at.desc()).limit(limit)
    return list((await db.execute(stmt)).scalars().all())


async def current_names(
    db: AsyncSession, reqs: list[NameChangeRequest]
) -> dict[tuple[int, int], tuple[str, str]]:
    """Talep sahiplerinin güncel adları — rol tablosu başına tek `IN` sorgusu."""
    ids_by_role: dict[int, set[int]] = {}
    for req in reqs:
        ids_by_role.setdefault(req.role_id, set()).add(req.user_id)
    out: dict[tuple[int, int], tuple[str, str]] = {}
    for role_id, ids in ids_by_role.items():
        model = _ROLE_MODELS.get(role_id)
        if model is None:
            continue
        rows = await db.execute(
            select(model.id, model.first_name, model.last_name).where(model.id.in_(ids))
        )
        for uid, first, last in rows.all():
            out[(role_id, uid)] = (first, last)
    return out


async def _get_pending(db: AsyncSession, request_id: int) -> NameChangeRequest:
    req = await db.get(NameChangeRequest, request_id)
    if req is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Talep bulunamadı")
    if req.status != "PENDING":
        raise HTTPException(status.HTTP_409_CONFLICT, "Talep zaten sonuçlanmış")
    return req


async def approve(
    db: AsyncSession, request_id: int, *, admin_id: int
) -> NameChangeRequest:
    req = await _get_pending(db, request_id)
    model = _ROLE_MODELS.get(req.role_id)
    user = await db.get(model, req.user_id) if model else None
    if user is None or user.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kullanıcı bulunamadı")

    # Tek tür kaldı: NAME. (Kullanıcı adı dalı 5 Eyl 2026'da kaldırıldı ve
    # `kind='USERNAME'` satırları migration'da silindi.)
    if req.kind == "NAME":
        if req.new_first_name:
            user.first_name = req.new_first_name
        if req.new_last_name:
            user.last_name = req.new_last_name
        user.name_change_count += 1

    req.status = "APPROVED"
    req.reviewed_by = admin_id
    req.reviewed_at = _now()
    await db.flush()
    await notification_service.notify(
        db,
        user_id=req.user_id,
        role_id=req.role_id,
        message="Ad değişikliği talebin onaylandı.",
        link=frontend_yollari.HESABIM,
    )
    return req


async def reject(
    db: AsyncSession, request_id: int, *, admin_id: int, note: str | None = None
) -> NameChangeRequest:
    req = await _get_pending(db, request_id)
    req.status = "REJECTED"
    req.review_note = (note or "").strip() or None
    req.reviewed_by = admin_id
    req.reviewed_at = _now()
    await db.flush()
    await notification_service.notify(
        db,
        user_id=req.user_id,
        role_id=req.role_id,
        message="Ad değişikliği talebin reddedildi.",
        link=frontend_yollari.HESABIM,
    )
    return req
