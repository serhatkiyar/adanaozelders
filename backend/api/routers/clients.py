from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_admin_permission, require_roles_or_admin_permission
from core.database import get_db
from models.admin import Admin
from models.client import Client
from models.role import RoleType
from models.tutor import Gender, Tutor, TutorStatus
from schemas.education import EducationOut
from schemas.user import ClientPublicOut, ClientSearchOut
from services import booking_service, client_service, education_service

router = APIRouter(prefix="/clients", tags=["clients"])


async def _approved_viewer(
    user=Depends(require_roles_or_admin_permission("users.view", RoleType.TUTOR)),
):
    """Admin geçer; eğitmen YALNIZ onaylıysa (APPROVED) geçer.

    Bu uçlar öğrencilerin ad-soyad, doğum tarihi ve cinsiyetini döndürüyor.
    Rol kontrolü tek başına yeterli değildi: herkes TUTOR olarak kayıt olup
    (DRAFT/PENDING durumda, admin onayı beklemeden) tüm öğrenci tabanını
    sayfalayabiliyordu. Kitlenin bir kısmı reşit değil.
    """
    if isinstance(user, Tutor) and user.status != TutorStatus.APPROVED:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Bu bilgiye yalnız onaylı eğitmenler erişebilir.",
        )
    return user


@router.get("/search", response_model=list[ClientSearchOut])
async def search_clients(
    q: str | None = Query(default=None),
    gender: Gender | None = Query(default=None),
    min_age: int | None = Query(default=None, ge=0, le=120),
    max_age: int | None = Query(default=None, ge=0, le=120),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _viewer: Admin = Depends(require_admin_permission("users.view")),
    db: AsyncSession = Depends(get_db),
):
    """Toplu öğrenci dizini — YALNIZ `users.view` izinli admin (İP-3 §4.1).

    Eğitmene kapalıdır: onaylı bir eğitmen bile bütün öğrenci tabanını
    (ad-soyad, doğum tarihi, cinsiyet) sayfalayamaz. Ürün karşılığı da yok —
    eğitmenin kullandığı tek yüzey, ders/soru/mesaj bağlamından açılan tekil
    öğrenci profili (`GET /clients/{id}`, ilişki kapılı).
    """
    return await client_service.search_clients(
        db,
        q=q,
        gender=gender,
        min_age=min_age,
        max_age=max_age,
        limit=limit,
        offset=offset,
    )


# Dinamik path; statik /search rotasından SONRA tanımlanmalı.
@router.get("/{client_id}", response_model=ClientPublicOut)
async def get_client_public(
    client_id: int,
    viewer=Depends(_approved_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Tekil öğrenci profili — ilişki kapılı (İP-3 §4.2-4.4).

    Eğitmen yalnız aralarında rezervasyon kaydı olan öğrenciyi görür (PENDING
    dahil; geçmiş ders ilişkiyi düşürmez). İlişkisiz öğrenci ile var olmayan id
    AYNI 404'ü alır — ardışık id taramasıyla varlık sızmaz. Eğitmene tam
    `birth_date` dönmez; ders seviyesi için gereken `age` döner.
    """
    not_found = HTTPException(status.HTTP_404_NOT_FOUND, "Client not found")
    client = await db.get(Client, client_id)
    if client is None or client.deleted_at is not None or not client.is_active:
        raise not_found
    if isinstance(viewer, Tutor) and not await booking_service.has_relationship(
        db, tutor_id=viewer.id, client_id=client.id
    ):
        raise not_found

    completed = await booking_service.count_completed(
        db, role_id=client.role_id, user_id=client.id
    )
    educations = await education_service.list_by(
        db, role_id=client.role_id, owner_id=client.id
    )
    return ClientPublicOut(
        id=client.id,
        full_name=client.full_name,
        username=client.username,
        about=client.about,
        avatar_url=client.avatar_url,
        # Tam doğum tarihi yalnız users.view izinli admine (destek/moderasyon).
        birth_date=client.birth_date if isinstance(viewer, Admin) else None,
        age=client_service.age_of(client.birth_date),
        gender=client.gender,
        created_at=client.created_at,
        last_seen_at=client.last_seen_at,
        completed_lessons=completed,
        educations=[EducationOut.model_validate(e) for e in educations],
    )
