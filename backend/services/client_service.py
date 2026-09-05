from __future__ import annotations

import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.client import Client
from models.tutor import Gender


def age_of(
    birth_date: datetime.date | None, *, today: datetime.date | None = None
) -> int | None:
    """Doğum tarihinden yaş (İP-3 §4.4): eğitmene tam `birth_date` dönmez —
    ders seviyesi için gereken bilgi yaştır; tam tarih kimlik doğrulama ve
    hesap kurtarma saldırılarında kullanılan bir alandır."""
    if birth_date is None:
        return None
    today = today or datetime.date.today()
    had_birthday = (today.month, today.day) >= (birth_date.month, birth_date.day)
    return today.year - birth_date.year - (0 if had_birthday else 1)


def _years_ago(years: int) -> datetime.date:
    today = datetime.date.today()
    try:
        return today.replace(year=today.year - years)
    except ValueError:  # 29 Şubat
        return today.replace(year=today.year - years, day=28)


async def search_clients(
    db: AsyncSession,
    *,
    q: str | None = None,
    gender: Gender | None = None,
    min_age: int | None = None,
    max_age: int | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[Client]:
    stmt = select(Client).where(
        Client.is_active.is_(True),
        Client.deleted_at.is_(None),
    )

    if q:
        like = f"%{q.strip()}%"
        full_name = func.concat(Client.first_name, " ", Client.last_name)
        # Kullanıcı adı yüklemi 5 Eyl 2026'da kaldırıldı (alan silindi). Geriye
        # tek yüklem kaldı ve arama DARALDI — kabul edilen bir daralma:
        # kullanıcı adı zaten ad-soyaddan türetiliyordu, yani her eşleşmesi
        # pratikte bir ad eşleşmesiydi. TELAFİ OLARAK E-POSTA EKLENMEZ:
        # öğrenci aramasını eğitmenler yapıyor ve e-postayı yükleme sokmak
        # İP-3'ün kapattığı kimlik sızıntısını yeniden açar.
        stmt = stmt.where(full_name.ilike(like))

    if gender is not None:
        stmt = stmt.where(Client.gender == gender)
    if min_age is not None:
        stmt = stmt.where(Client.birth_date <= _years_ago(min_age))
    if max_age is not None:
        stmt = stmt.where(Client.birth_date > _years_ago(max_age + 1))

    stmt = (
        stmt.order_by(Client.last_seen_at.desc().nulls_last(), Client.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return list((await db.execute(stmt)).scalars().all())
