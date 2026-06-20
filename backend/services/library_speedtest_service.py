"""Kütüphane internet hız testi iş mantığı.

Ölçüm istemcide (tarayıcı) gerçek indirme/yükleme/ping ile yapılır; burada yalnız
sonucu kaydeder ve kütüphane başına ortalama/son test istatistiğini üretiriz.
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.library import Library, LibraryStatus
from models.library_speedtest import LibrarySpeedTest
from schemas.library import (
    LibrarySpeedTestOut,
    LibrarySpeedTestStats,
    SpeedTestCreate,
)

_RECENT_LIMIT = 5


async def _active_library_or_404(db: AsyncSession, library_id: int) -> Library:
    lib = await db.get(Library, library_id)
    if (
        lib is None
        or lib.deleted_at is not None
        or lib.status != LibraryStatus.ACTIVE.value
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kütüphane bulunamadı")
    return lib


async def record(
    db: AsyncSession, *, user, library_id: int, payload: SpeedTestCreate
) -> LibrarySpeedTest:
    await _active_library_or_404(db, library_id)
    row = LibrarySpeedTest(
        library_id=library_id,
        role_id=user.role_id,
        user_id=user.id,
        download_mbps=round(payload.download_mbps, 2),
        upload_mbps=round(payload.upload_mbps, 2),
        ping_ms=payload.ping_ms,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return row


async def stats(db: AsyncSession, library_id: int) -> LibrarySpeedTestStats:
    """Kütüphane için ortalama indirme/yükleme/ping + son N testi döner (public)."""
    agg = (
        await db.execute(
            select(
                func.count(LibrarySpeedTest.id),
                func.avg(LibrarySpeedTest.download_mbps),
                func.avg(LibrarySpeedTest.upload_mbps),
                func.avg(LibrarySpeedTest.ping_ms),
                func.max(LibrarySpeedTest.created_at),
            ).where(LibrarySpeedTest.library_id == library_id)
        )
    ).one()
    count = int(agg[0] or 0)
    if count == 0:
        return LibrarySpeedTestStats(count=0)

    recent_rows = (
        await db.execute(
            select(LibrarySpeedTest)
            .where(LibrarySpeedTest.library_id == library_id)
            .order_by(LibrarySpeedTest.id.desc())
            .limit(_RECENT_LIMIT)
        )
    ).scalars().all()

    return LibrarySpeedTestStats(
        count=count,
        avg_download_mbps=round(float(agg[1]), 2) if agg[1] is not None else None,
        avg_upload_mbps=round(float(agg[2]), 2) if agg[2] is not None else None,
        avg_ping_ms=round(float(agg[3])) if agg[3] is not None else None,
        last_tested_at=agg[4],
        recent=[LibrarySpeedTestOut.model_validate(r) for r in recent_rows],
    )
