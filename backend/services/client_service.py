from __future__ import annotations

import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.client import Client
from models.tutor import Gender


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
        stmt = stmt.where(or_(full_name.ilike(like), Client.username.ilike(like)))

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
