"""Duyuru şeridi — seçim mantığı + admin CRUD."""
from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.duyuru import DuyuruSeridi
from schemas.duyuru import DuyuruCreate, DuyuruUpdate


async def get_aktif(
    db: AsyncSession, *, simdi: datetime.datetime | None = None
) -> DuyuruSeridi | None:
    """Şu an gösterilecek tek kaydı döner; uygun kayıt yoksa `None`.

    Rotasyon YOKTUR: birden fazla uygun kayıt varsa `sira ASC, id DESC` ile
    en üsttekinin gösterilmesi kararlaştırılır.

    `simdi` normalde `None` — gerçek "şimdi" kullanılır. Testler tam sınır
    (`baslangic_at`/`bitis_at` == "şimdi") davranışını Python saatiyle DB
    saati arasındaki kaçınılmaz kaymadan (birkaç ms) bağımsız ölçmek için
    sabit bir değer geçebilir.
    """
    simdi = simdi or datetime.datetime.now(datetime.timezone.utc)
    stmt = (
        select(DuyuruSeridi)
        .where(DuyuruSeridi.aktif.is_(True))
        .where(
            or_(
                DuyuruSeridi.baslangic_at.is_(None),
                DuyuruSeridi.baslangic_at <= simdi,
            )
        )
        .where(
            or_(
                DuyuruSeridi.bitis_at.is_(None),
                DuyuruSeridi.bitis_at > simdi,
            )
        )
        .order_by(DuyuruSeridi.sira.asc(), DuyuruSeridi.id.desc())
        .limit(1)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def list_all(db: AsyncSession) -> list[DuyuruSeridi]:
    stmt = select(DuyuruSeridi).order_by(DuyuruSeridi.sira.asc(), DuyuruSeridi.id.desc())
    return list((await db.execute(stmt)).scalars().all())


async def _get_or_404(db: AsyncSession, duyuru_id: int) -> DuyuruSeridi:
    kayit = await db.get(DuyuruSeridi, duyuru_id)
    if kayit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Duyuru bulunamadı")
    return kayit


async def create(db: AsyncSession, payload: DuyuruCreate) -> DuyuruSeridi:
    kayit = DuyuruSeridi(**payload.model_dump())
    db.add(kayit)
    await db.commit()
    await db.refresh(kayit)
    return kayit


async def update(db: AsyncSession, duyuru_id: int, payload: DuyuruUpdate) -> DuyuruSeridi:
    kayit = await _get_or_404(db, duyuru_id)
    for alan, deger in payload.model_dump(exclude_unset=True).items():
        setattr(kayit, alan, deger)
    await db.commit()
    await db.refresh(kayit)
    return kayit


async def delete(db: AsyncSession, duyuru_id: int) -> None:
    kayit = await _get_or_404(db, duyuru_id)
    await db.delete(kayit)
    await db.commit()
