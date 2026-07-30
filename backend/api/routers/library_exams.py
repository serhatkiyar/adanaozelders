from __future__ import annotations

from fastapi import (
    APIRouter,
    Body,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import (
    CurrentUser,
    require_roles,
    require_roles_or_admin_permission,
    user_rate_limit,
)
from core.config import settings
from core.database import get_db
from models.admin import Admin
from models.client import Client
from models.library_exam import LibraryExamSession
from models.library_operator import LibraryOperator
from models.role import ROLE_IDS, RoleType
from schemas.library_exam import (
    AttendanceResult,
    BulkDocumentOut,
    ExamSessionCreate,
    ExamSessionOut,
    ExamSessionUpdate,
    PayResult,
    PublishResultsOut,
    QRVerifyIn,
    RegistrationCreate,
    RegistrationOut,
    ResultSummaryIn,
    RosterRow,
)
from services import library_exam_service, payment_gates, phone_service

# Sonuç belgesi (karne/optik) ve oturum cevap anahtarı: PDF veya görsel, 20MB.
_MAX_DOC_BYTES = 20 * 1024 * 1024


async def _read_doc(file: UploadFile) -> bytes:
    ct = file.content_type or ""
    if not (ct == "application/pdf" or ct.startswith("image/")):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Yalnız PDF veya görsel yüklenebilir."
        )
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Boş dosya.")
    if len(data) > _MAX_DOC_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Dosya 20MB sınırını aşıyor.")
    return data


def _entered_by(user: CurrentUser) -> tuple[int, int]:
    """(user_id, role_id) — sonucu giren kullanıcının denetim kimliği."""
    role = RoleType.ADMIN if isinstance(user, Admin) else RoleType.LIBRARY_OPERATOR
    return user.id, ROLE_IDS[role]

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
    user: CurrentUser = Depends(require_roles_or_admin_permission("libraries.manage", RoleType.LIBRARY_OPERATOR)),
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
    user: CurrentUser = Depends(require_roles_or_admin_permission("libraries.manage", RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    _assert_can_manage(user, library_id)
    return await library_exam_service.create_session(db, library_id, payload)


@router.patch("/exam-sessions/{session_id}", response_model=ExamSessionOut)
async def update_session(
    session_id: int,
    payload: ExamSessionUpdate,
    user: CurrentUser = Depends(require_roles_or_admin_permission("libraries.manage", RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    s = await _get_session_or_404(db, session_id)
    _assert_can_manage(user, s.library_id)
    return await library_exam_service.update_session(db, session_id, payload)


@router.post("/exam-sessions/{session_id}/cancel", response_model=ExamSessionOut)
async def cancel_session(
    session_id: int,
    user: CurrentUser = Depends(require_roles_or_admin_permission("libraries.manage", RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    s = await _get_session_or_404(db, session_id)
    _assert_can_manage(user, s.library_id)
    return await library_exam_service.cancel_session(db, session_id)


@router.get("/exam-sessions/{session_id}/roster", response_model=list[RosterRow])
async def session_roster(
    session_id: int,
    user: CurrentUser = Depends(require_roles_or_admin_permission("libraries.manage", RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    s = await _get_session_or_404(db, session_id)
    _assert_can_manage(user, s.library_id)
    return await library_exam_service.roster(db, session_id)


# ── Sonuç girişi + yayınlama (admin / o kütüphanenin operatörü) ──────────────────


@router.get("/exam-sessions/{session_id}/results/reference")
async def results_reference(
    session_id: int,
    user: CurrentUser = Depends(require_roles_or_admin_permission("libraries.manage", RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    """Toplu karne yükleme için referans CSV'si (registration_id + öğrenci adı).
    Operatör her karne PDF'ini ilgili kayıt no ile adlandırır."""
    s = await _get_session_or_404(db, session_id)
    _assert_can_manage(user, s.library_id)
    rows = await library_exam_service.roster(db, session_id)
    csv_text = library_exam_service.results_reference_csv(rows)
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="oturum-{session_id}-referans.csv"'
        },
    )


@router.put(
    "/exam-sessions/{session_id}/results/{registration_id}/summary",
    response_model=RosterRow,
)
async def set_result_summary(
    session_id: int,
    registration_id: int,
    payload: ResultSummaryIn,
    user: CurrentUser = Depends(require_roles_or_admin_permission("libraries.manage", RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    """Opsiyonel hızlı özet: toplam net + sıralama (karne başlığından)."""
    s = await _get_session_or_404(db, session_id)
    _assert_can_manage(user, s.library_id)
    user_id, role_id = _entered_by(user)
    return await library_exam_service.set_result_summary(
        db, session_id, registration_id, payload, user_id=user_id, role_id=role_id
    )


@router.post(
    "/exam-sessions/{session_id}/results/{registration_id}/document",
    response_model=RosterRow,
)
async def upload_result_document(
    session_id: int,
    registration_id: int,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_roles_or_admin_permission("libraries.manage", RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    """Bir öğrencinin bireysel karnesini (PDF/görsel) yükler — birincil sonuç."""
    s = await _get_session_or_404(db, session_id)
    _assert_can_manage(user, s.library_id)
    data = await _read_doc(file)
    user_id, role_id = _entered_by(user)
    return await library_exam_service.set_result_document(
        db,
        session_id,
        registration_id,
        file_bytes=data,
        original_name=file.filename,
        content_type=file.content_type,
        user_id=user_id,
        role_id=role_id,
    )


@router.post("/exam-sessions/{session_id}/results/bulk", response_model=BulkDocumentOut)
async def bulk_upload_documents(
    session_id: int,
    files: list[UploadFile] = File(...),
    user: CurrentUser = Depends(require_roles_or_admin_permission("libraries.manage", RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    """Toplu karne yükleme — her dosya adının başındaki kayıt no ile eşlenir."""
    s = await _get_session_or_404(db, session_id)
    _assert_can_manage(user, s.library_id)
    if not files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "En az bir dosya seçin.")
    payload: list[tuple[str | None, str | None, bytes]] = []
    for f in files:
        payload.append((f.filename, f.content_type, await _read_doc(f)))
    user_id, role_id = _entered_by(user)
    return await library_exam_service.bulk_upload_documents(
        db, session_id, payload, user_id=user_id, role_id=role_id
    )


@router.post("/exam-sessions/{session_id}/results/publish", response_model=PublishResultsOut)
async def publish_results(
    session_id: int,
    user: CurrentUser = Depends(require_roles_or_admin_permission("libraries.manage", RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    s = await _get_session_or_404(db, session_id)
    _assert_can_manage(user, s.library_id)
    return await library_exam_service.publish_results(db, session_id)


@router.post("/exam-sessions/{session_id}/answer-key", response_model=ExamSessionOut)
async def upload_session_answer_key(
    session_id: int,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_roles_or_admin_permission("libraries.manage", RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    s = await _get_session_or_404(db, session_id)
    _assert_can_manage(user, s.library_id)
    data = await _read_doc(file)
    return await library_exam_service.set_session_answer_key(
        db,
        session_id,
        file_bytes=data,
        original_name=file.filename,
        content_type=file.content_type,
    )


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
    await payment_gates.assert_branch_open(
        db, payment_gates.PaymentBranch.LIBRARY_MARKETPLACE
    )
    return await library_exam_service.register(db, client, payload.session_id)


@router.post(
    "/exam-registrations/{registration_id}/pay",
    response_model=PayResult,
    dependencies=[Depends(_pay_limit)],
)
async def pay(
    registration_id: int,
    request: Request,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    await payment_gates.assert_branch_open(
        db, payment_gates.PaymentBranch.LIBRARY_MARKETPLACE
    )
    phone_service.require_phone_verified(client)
    registration, redirect_url = await library_exam_service.pay(
        db, client, registration_id,
        client_ip=request.client.host if request.client else None,
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
