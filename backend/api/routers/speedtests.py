from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_roles, user_rate_limit
from core.config import settings
from core.database import get_db
from models.client import Client
from models.role import RoleType
from schemas.library import (
    LibrarySpeedTestOut,
    LibrarySpeedTestStats,
    SpeedTestCreate,
)
from services import library_speedtest_service

# Ölçüm istemcide Cloudflare edge'ine yapılır (genel internet hızı); burada yalnız
# sonucu kütüphaneye kaydeder ve ortalama/son test istatistiğini sunarız.
router = APIRouter(prefix="/library-speedtests", tags=["speedtest"])

_record_limit = user_rate_limit(
    key="speedtest_record",
    limit=settings.RATE_LIMIT_REVIEW,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)


@router.get("/{library_id}", response_model=LibrarySpeedTestStats)
async def get_library_speedtests(
    library_id: int, db: AsyncSession = Depends(get_db)
):
    return await library_speedtest_service.stats(db, library_id)


@router.post(
    "/{library_id}",
    response_model=LibrarySpeedTestOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_record_limit)],
)
async def record_library_speedtest(
    library_id: int,
    payload: SpeedTestCreate,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    # TODO(konum): kayıttan önce kullanıcının gerçekten kütüphanede olduğunu
    # doğrula (tarayıcı geolocation → Haversine yakınlık ~<300m, ya da çalışma/
    # deneme QR girişi). Şimdilik self-reported.
    row = await library_speedtest_service.record(
        db, user=client, library_id=library_id, payload=payload
    )
    return LibrarySpeedTestOut.model_validate(row)
