from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_roles
from core import storage
from core.config import settings
from core.database import get_db
from models.client import Client
from models.role import RoleType
from models.tutor import Tutor
from schemas.education import (
    EducationCreate,
    EducationUpdate,
    OwnEducationOut,
)
from services import education_service

router = APIRouter(prefix="/me/educations", tags=["educations"])

_OwnerUser = Tutor | Client


@router.get("", response_model=list[OwnEducationOut])
async def list_my_educations(
    user: _OwnerUser = Depends(require_roles(RoleType.TUTOR, RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await education_service.list_own(db, user)


@router.post("", response_model=OwnEducationOut, status_code=status.HTTP_201_CREATED)
async def add_education(
    payload: EducationCreate,
    user: _OwnerUser = Depends(require_roles(RoleType.TUTOR, RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await education_service.create(db, user, payload)


@router.patch("/{education_id}", response_model=OwnEducationOut)
async def edit_education(
    education_id: int,
    payload: EducationUpdate,
    user: _OwnerUser = Depends(require_roles(RoleType.TUTOR, RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await education_service.update(db, user, education_id, payload)


@router.delete("/{education_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_education(
    education_id: int,
    user: _OwnerUser = Depends(require_roles(RoleType.TUTOR, RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    await education_service.delete(db, user, education_id)


@router.post("/{education_id}/document", response_model=OwnEducationOut)
async def upload_education_document(
    education_id: int,
    file: UploadFile = File(...),
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    """Eğitim kaydına diploma/belge yükler (PDF/görsel/doküman). Yalnız eğitmen."""
    if not storage.is_allowed_resource(file.filename):
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Desteklenmeyen dosya türü"
        )
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Boş dosya")
    if len(data) > settings.MAX_RESOURCE_SIZE_BYTES:
        mb = settings.MAX_RESOURCE_SIZE_BYTES // (1024 * 1024)
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"Dosya çok büyük (en fazla {mb} MB)",
        )
    url = await storage.upload_file(
        data,
        original_name=file.filename,
        content_type=file.content_type,
        prefix="education-docs",
    )
    return await education_service.set_document(
        db, tutor, education_id, url=url, document_name=file.filename or "diploma"
    )
