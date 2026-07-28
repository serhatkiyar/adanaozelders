from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_admin_permission, require_roles_or_admin_permission
from core.database import get_db
from models.admin import Admin
from models.library import Library, LibraryStatus
from models.library_operator import LibraryOperator
from models.role import RoleType
from schemas.library_exam_catalog import CatalogCreate, CatalogOut, CatalogUpdate
from services import audit_service, library_exam_catalog_service

router = APIRouter(prefix="/exam-catalogs", tags=["exam-catalogs"])

# Cevap anahtarı: PDF veya görsel; 20MB üst sınır.
_MAX_KEY_BYTES = 20 * 1024 * 1024
_ALLOWED_KEY_TYPES = ("application/pdf", "image/")


async def _read_answer_key(file: UploadFile) -> bytes:
    ct = file.content_type or ""
    if not (ct == "application/pdf" or ct.startswith("image/")):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Cevap anahtarı yalnız PDF veya görsel olabilir."
        )
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Boş dosya.")
    if len(data) > _MAX_KEY_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Dosya 20MB sınırını aşıyor.")
    return data


# ── Oturum açarken kullanılabilir kataloglar (admin + operatör) ──────────────────
# NOT: /{catalog_id} route'larından ÖNCE tanımlı olmalı.


async def _usable_viewer(
    user=Depends(require_roles_or_admin_permission("catalogs.view", RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    """Admin geçer; operatör YALNIZ kütüphanesi ACTIVE ise geçer.

    Self-servis kayıt anında LIBRARY_OPERATOR token'ı verdiğinden, rol kontrolü
    tek başına herkesin katalog listesine ulaşmasına izin verirdi.
    """
    if isinstance(user, LibraryOperator):
        lib = await db.get(Library, user.library_id)
        if lib is None or lib.deleted_at is not None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Kütüphane bulunamadı")
        if lib.status != LibraryStatus.ACTIVE.value:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Kütüphaneniz henüz onaylanmadı; katalogları onaydan sonra görebilirsiniz.",
            )
    return user


@router.get("/usable", response_model=list[CatalogOut])
async def list_usable_catalogs(
    user=Depends(_usable_viewer),
    db: AsyncSession = Depends(get_db),
):
    # Cevap anahtarı URL'i operatöre VERİLMEZ (yalnız "var mı" bilgisi); admin
    # küratör listesinde (`GET ""`) görünür. Bkz. list_usable(include_answer_key).
    return await library_exam_catalog_service.list_usable(
        db, include_answer_key=isinstance(user, Admin)
    )


# ── Admin küratör CRUD ───────────────────────────────────────────────────────────


@router.get("", response_model=list[CatalogOut])
async def list_catalogs(
    _admin: Admin = Depends(require_admin_permission("catalogs.view")),
    db: AsyncSession = Depends(get_db),
):
    return await library_exam_catalog_service.list_catalogs(db)


@router.post("", response_model=CatalogOut, status_code=status.HTTP_201_CREATED)
async def create_catalog(
    payload: CatalogCreate,
    admin: Admin = Depends(require_admin_permission("catalogs.manage")),
    db: AsyncSession = Depends(get_db),
):
    catalog = await library_exam_catalog_service.create_catalog(db, admin, payload)
    await audit_service.record(
        db, actor=admin, action="exam_catalog.create", target_type="exam_catalog",
        target_id=catalog.id, details=catalog.exam_name,
    )
    return catalog


@router.patch("/{catalog_id}", response_model=CatalogOut)
async def update_catalog(
    catalog_id: int,
    payload: CatalogUpdate,
    admin: Admin = Depends(require_admin_permission("catalogs.manage")),
    db: AsyncSession = Depends(get_db),
):
    catalog = await library_exam_catalog_service.update_catalog(db, catalog_id, payload)
    await audit_service.record(
        db, actor=admin, action="exam_catalog.update", target_type="exam_catalog",
        target_id=catalog_id, after=payload.model_dump(exclude_unset=True),
    )
    return catalog


@router.delete("/{catalog_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_catalog(
    catalog_id: int,
    admin: Admin = Depends(require_admin_permission("catalogs.manage")),
    db: AsyncSession = Depends(get_db),
):
    await library_exam_catalog_service.delete_catalog(db, catalog_id)
    await audit_service.record(
        db, actor=admin, action="exam_catalog.delete", target_type="exam_catalog",
        target_id=catalog_id,
    )


@router.post("/{catalog_id}/answer-key", response_model=CatalogOut)
async def upload_answer_key(
    catalog_id: int,
    file: UploadFile = File(...),
    admin: Admin = Depends(require_admin_permission("catalogs.manage")),
    db: AsyncSession = Depends(get_db),
):
    data = await _read_answer_key(file)
    catalog = await library_exam_catalog_service.set_answer_key(
        db,
        catalog_id,
        file_bytes=data,
        original_name=file.filename,
        content_type=file.content_type,
    )
    await audit_service.record(
        db, actor=admin, action="exam_catalog.answer_key", target_type="exam_catalog",
        target_id=catalog_id, meta={"filename": file.filename},
    )
    return catalog
