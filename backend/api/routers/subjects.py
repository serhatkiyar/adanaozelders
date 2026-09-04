"""Ders kataloğu — public okuma uçları (oturum gerektirmez).

Frontend'in ders listesi bugüne kadar iki ayrı TypeScript sabitinden geliyordu
ve ikisi sessizce ayrışmıştı. Bu uç o listelerin yerine geçer: tek kaynak
veritabanıdır.

Build-time anlık görüntü BİLEREK üretilmiyor — frontend sabiti ile sunucu
gerçeğinin ayrışması tam olarak sökmeye çalıştığımız hastalık.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from schemas.subject import LevelScaleOut, SubjectOut
from services import subject_service

router = APIRouter(prefix="/subjects", tags=["subjects"])

#: Katalog nadiren değişir (admin küratörlüğü). Bir saatlik public önbellek,
#: her ziyaretçinin ilk isteğinde 846 kalemi yeniden çekmesini önler.
_CACHE = "public, max-age=3600"


@router.get("", response_model=list[SubjectOut])
async def list_subjects(
    response: Response,
    kapsam: Literal["vitrin", "secim"] = Query(
        default="vitrin",
        description="vitrin = öğrenciye gösterilen küratörlü liste; "
        "secim = eğitmenin branş bildirirken göreceği tam katalog",
    ),
    db: AsyncSession = Depends(get_db),
):
    """Ders kataloğu (düz liste; ağaç `parent_id` ile kurulur).

    İki kapsam var çünkü iki yüzeyin ihtiyacı zıt: öğrenciye arkasında eğitmen
    olmayan ders gösterilmez (sıfır sonuç üretir), eğitmene ise kataloğun
    tamamı gösterilir (yoksa branşını bildiremez).
    """
    response.headers["Cache-Control"] = _CACHE
    return await subject_service.list_subjects(db, only_active=kapsam == "vitrin")


@router.get("/levels", response_model=list[LevelScaleOut])
async def list_levels(response: Response, db: AsyncSession = Depends(get_db)):
    """Seviye merdivenleri ve basamakları.

    Derse göre hangi merdivenin geçerli olduğu `SubjectOut.scales` alanındadır:
    okul dersinde kademe, dilde A1–C2, hobide başlangıç/orta/ileri.
    """
    response.headers["Cache-Control"] = _CACHE
    return await subject_service.list_level_scales(db)
