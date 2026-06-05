from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_roles
from core.database import get_db
from models.admin import Admin
from models.role import RoleType
from schemas.library_exam_catalog import CatalogCreate, CatalogOut, CatalogUpdate
from services import library_exam_catalog_service

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


@router.get("/usable", response_model=list[CatalogOut])
async def list_usable_catalogs(
    _user=Depends(require_roles(RoleType.ADMIN, RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    return await library_exam_catalog_service.list_usable(db)


# ── Admin küratör CRUD ───────────────────────────────────────────────────────────


@router.get("", response_model=list[CatalogOut])
async def list_catalogs(
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await library_exam_catalog_service.list_catalogs(db)


@router.post("", response_model=CatalogOut, status_code=status.HTTP_201_CREATED)
async def create_catalog(
    payload: CatalogCreate,
    admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await library_exam_catalog_service.create_catalog(db, admin, payload)


@router.patch("/{catalog_id}", response_model=CatalogOut)
async def update_catalog(
    catalog_id: int,
    payload: CatalogUpdate,
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await library_exam_catalog_service.update_catalog(db, catalog_id, payload)


@router.delete("/{catalog_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_catalog(
    catalog_id: int,
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    await library_exam_catalog_service.delete_catalog(db, catalog_id)


@router.post("/{catalog_id}/answer-key", response_model=CatalogOut)
async def upload_answer_key(
    catalog_id: int,
    file: UploadFile = File(...),
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    data = await _read_answer_key(file)
    return await library_exam_catalog_service.set_answer_key(
        db,
        catalog_id,
        file_bytes=data,
        original_name=file.filename,
        content_type=file.content_type,
    )
