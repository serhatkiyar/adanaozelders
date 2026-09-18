"""Kök SEO sayfaları (Modül 6) — public okuma uçları.

`GET /seo/sayfa?yol=/x` frontend'in "bu kök adres ne?" sorusudur: ilan,
ders/ilçe sayfası, kalıcı yönlendirme ya da 404. Ön-çizim (`/__sayfa`) ile
AYNI servis fonksiyonunu kullanır; iki yüzeyin içeriği ayrışamaz.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from schemas.seo import PopulerDersOut, SeoSayfaOut
from services import seo_sayfa_service

router = APIRouter(prefix="/seo", tags=["seo"])


@router.get("/sayfa", response_model=SeoSayfaOut)
async def seo_sayfa(
    yol: str = Query(..., min_length=2, max_length=300),
    db: AsyncSession = Depends(get_db),
):
    sonuc = await seo_sayfa_service.sayfa(db, yol)
    if sonuc is None:
        raise HTTPException(status_code=404, detail="Sayfa bulunamadı.")
    return sonuc


@router.get("/populer-dersler", response_model=list[PopulerDersOut])
async def populer_dersler(
    response: Response,
    limit: int = Query(default=8, ge=1, le=24),
    db: AsyncSession = Depends(get_db),
):
    """En çok öğretmeni olan dersler — ana sayfa ve footer iç linkleri."""
    response.headers["Cache-Control"] = "public, max-age=600"
    return await seo_sayfa_service.populer_dersler(db, limit)
