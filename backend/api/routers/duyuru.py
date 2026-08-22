"""Duyuru şeridi — public uç.

Panel CRUD `api/routers/admin.py`de (`/admin/duyuru-seridi`) yaşar; burada
yalnız storefront'un okuduğu tek satır vardır.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from schemas.duyuru import DuyuruAktifOut
from services import duyuru_service

router = APIRouter(prefix="/duyuru-seridi", tags=["duyuru-seridi"])

_CACHE_CONTROL = "public, max-age=60"


@router.get("/aktif", response_model=None)
async def get_aktif_duyuru(db: AsyncSession = Depends(get_db)) -> Response:
    """Kimlik doğrulaması gerektirmez; kişisel veri taşımaz.

    Uygun kayıt yoksa gövdesiz **204** döner (`null` DEĞİL) — istemci
    tarafında "veri yok" ile "hâlâ yükleniyor" ayrımı böyle netleşir.
    """
    kayit = await duyuru_service.get_aktif(db)
    if kayit is None:
        return Response(status_code=204, headers={"Cache-Control": _CACHE_CONTROL})
    body = DuyuruAktifOut.model_validate(kayit, from_attributes=True)
    return JSONResponse(
        content=body.model_dump(mode="json"),
        headers={"Cache-Control": _CACHE_CONTROL},
    )
