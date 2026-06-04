from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import (
    CurrentUser,
    require_roles,
    user_rate_limit,
)
from core.config import settings
from core.database import get_db
from models.admin import Admin
from models.client import Client
from models.library_exam import LibraryExamSession
from models.library_operator import LibraryOperator
from models.role import RoleType
from schemas.library_exam import (
    AttendanceResult,
    ExamSessionCreate,
    ExamSessionOut,
    ExamSessionUpdate,
    PayResult,
    QRVerifyIn,
    RegistrationCreate,
    RegistrationOut,
)
from services import library_exam_service

router = APIRouter(tags=["library-exams"])

_pay_limit = user_rate_limit(
    key="exam_pay",
    limit=settings.RATE_LIMIT_PAYMENT,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)


def _assert_can_manage(user: CurrentUser, library_id: int) -> None:
    """Yalnız admin ya da o kütüphanenin operatörü oturum yönetebilir."""
    if isinstance(user, Admin):
        return
    if isinstance(user, LibraryOperator) and user.library_id == library_id:
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Bu kütüphanede yetkin yok")


async def _get_session_or_404(db: AsyncSession, session_id: int) -> LibraryExamSession:
    s = await db.get(LibraryExamSession, session_id)
    if s is None or s.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Oturum bulunamadı")
    return s


# ── Public: bir kütüphanenin yaklaşan oturumları ─────────────────────────────────


@router.get("/exam-sessions", response_model=list[ExamSessionOut])
async def list_public_sessions(
    library_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
):
    return await library_exam_service.list_public_sessions(db, library_id)


# ── Yönetim: admin veya kütüphane operatörü ──────────────────────────────────────


@router.get("/exam-sessions/manage", response_model=list[ExamSessionOut])
async def list_sessions_manage(
    library_id: int = Query(...),
    user: CurrentUser = Depends(require_roles(RoleType.ADMIN, RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    _assert_can_manage(user, library_id)
    return await library_exam_service.list_library_sessions_admin(db, library_id)


@router.post(
    "/exam-sessions", response_model=ExamSessionOut, status_code=status.HTTP_201_CREATED
)
async def create_session(
    library_id: int = Query(...),
    payload: ExamSessionCreate = Body(...),
    user: CurrentUser = Depends(require_roles(RoleType.ADMIN, RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    _assert_can_manage(user, library_id)
    return await library_exam_service.create_session(db, library_id, payload)


@router.patch("/exam-sessions/{session_id}", response_model=ExamSessionOut)
async def update_session(
    session_id: int,
    payload: ExamSessionUpdate,
    user: CurrentUser = Depends(require_roles(RoleType.ADMIN, RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    s = await _get_session_or_404(db, session_id)
    _assert_can_manage(user, s.library_id)
    return await library_exam_service.update_session(db, session_id, payload)


@router.post("/exam-sessions/{session_id}/cancel", response_model=ExamSessionOut)
async def cancel_session(
    session_id: int,
    user: CurrentUser = Depends(require_roles(RoleType.ADMIN, RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    s = await _get_session_or_404(db, session_id)
    _assert_can_manage(user, s.library_id)
    return await library_exam_service.cancel_session(db, session_id)


@router.get("/exam-sessions/{session_id}/roster")
async def session_roster(
    session_id: int,
    user: CurrentUser = Depends(require_roles(RoleType.ADMIN, RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    s = await _get_session_or_404(db, session_id)
    _assert_can_manage(user, s.library_id)
    return await library_exam_service.roster(db, session_id)


# ── Öğrenci: kayıt + ödeme + biletlerim ──────────────────────────────────────────


@router.post(
    "/exam-registrations",
    response_model=RegistrationOut,
    status_code=status.HTTP_201_CREATED,
)
async def register(
    payload: RegistrationCreate,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await library_exam_service.register(db, client, payload.session_id)


@router.post(
    "/exam-registrations/{registration_id}/pay",
    response_model=PayResult,
    dependencies=[Depends(_pay_limit)],
)
async def pay(
    registration_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    registration, redirect_url = await library_exam_service.pay(
        db, client, registration_id
    )
    return PayResult(registration=registration, redirect_url=redirect_url)


@router.post(
    "/exam-registrations/{registration_id}/cancel",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def cancel_registration(
    registration_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    await library_exam_service.cancel_registration(db, client, registration_id)


@router.get("/exam-registrations/mine", response_model=list[RegistrationOut])
async def my_registrations(
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await library_exam_service.list_my_registrations(db, client)


# ── Operatör: QR doğrulama ───────────────────────────────────────────────────────


@router.post("/exam-attendance/verify", response_model=AttendanceResult)
async def verify_attendance(
    payload: QRVerifyIn,
    operator: LibraryOperator = Depends(require_roles(RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    return await library_exam_service.verify_attendance(
        db,
        operator_library_id=operator.library_id,
        operator_id=operator.id,
        payload=payload.payload,
    )


@router.post(
    "/exam-registrations/{registration_id}/attend", response_model=AttendanceResult
)
async def attend_by_registration(
    registration_id: int,
    operator: LibraryOperator = Depends(require_roles(RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    """Operatör katılımcı listesinden seçip doğrular (QR/kod olmadan)."""
    return await library_exam_service.verify_by_registration(
        db,
        operator_library_id=operator.library_id,
        operator_id=operator.id,
        registration_id=registration_id,
    )
