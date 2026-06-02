from __future__ import annotations

import datetime
from collections import defaultdict

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUser
from models.habit import PERIOD_WEEKLY, Habit, HabitEntry
from schemas.habit import HabitCreate, HabitUpdate

_DAY = datetime.timedelta(days=1)
_WEEK = datetime.timedelta(days=7)
# Isı haritasında gösterilen geçmiş pencere (17 hafta).
_RECENT_DAYS = 7 * 17
_MAX_COUNT = 99


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _monday(d: datetime.date) -> datetime.date:
    """Verilen günün içinde bulunduğu ISO haftasının Pazartesi'si."""
    return d - datetime.timedelta(days=d.weekday())


# ── Saf seri/istatistik hesabı (DB gerektirmez, birim testlidir) ─────
def _longest_run(units: set[datetime.date], step: datetime.timedelta) -> int:
    """`units` içindeki ardışık (step aralıklı) en uzun zinciri döndürür."""
    best = 0
    for d in units:
        if (d - step) in units:
            continue  # bir zincirin başı değil; tekrar saymayalım
        length = 1
        n = d + step
        while n in units:
            length += 1
            n += step
        best = max(best, length)
    return best


def _current_run(
    units: set[datetime.date], anchor: datetime.date, step: datetime.timedelta
) -> int:
    """`anchor`'dan geriye doğru kesintisiz zincir. Anchor tamamlanmadıysa bir
    önceki birimden başlar (bugün/bu hafta henüz yapılmadıysa seri kırılmaz)."""
    if anchor in units:
        start = anchor
    elif (anchor - step) in units:
        start = anchor - step
    else:
        return 0
    streak = 0
    d = start
    while d in units:
        streak += 1
        d -= step
    return streak


def compute_habit_stats(
    period: str,
    target: int,
    counts: dict[datetime.date, int],
    today: datetime.date,
) -> dict:
    """Bir alışkanlığın seri/ilerleme metriklerini hesaplar.

    counts: {gün -> o günkü sayaç}. Günlükte bir gün, haftalıkta bir hafta
    "tamamlanmış" sayılır (sayaç toplamı hedefe ulaşınca)."""
    target = max(1, target)

    if period == PERIOD_WEEKLY:
        step = _WEEK
        week_sums: dict[datetime.date, int] = defaultdict(int)
        for d, c in counts.items():
            week_sums[_monday(d)] += c
        complete = {wk for wk, s in week_sums.items() if s >= target}
        anchor = _monday(today)
        period_count = week_sums.get(anchor, 0)
    else:
        step = _DAY
        complete = {d for d, c in counts.items() if c >= target}
        anchor = today
        period_count = counts.get(today, 0)

    return {
        "current_streak": _current_run(complete, anchor, step),
        "longest_streak": _longest_run(complete, step),
        "total_completions": len(complete),
        "period_count": period_count,
        "today_count": counts.get(today, 0),
        "done": period_count >= target,
    }


def _attach_stats(
    habit: Habit, counts: dict[datetime.date, int], today: datetime.date
) -> None:
    stats = compute_habit_stats(
        habit.period, habit.target_per_period, counts, today
    )
    habit.current_streak = stats["current_streak"]
    habit.longest_streak = stats["longest_streak"]
    habit.total_completions = stats["total_completions"]
    habit.period_count = stats["period_count"]
    habit.today_count = stats["today_count"]
    habit.done = stats["done"]
    start = today - datetime.timedelta(days=_RECENT_DAYS - 1)
    habit.recent = {
        d.isoformat(): c for d, c in counts.items() if start <= d <= today
    }


# ── Sahiplik ─────────────────────────────────────────────────────
async def _owned_or_404(
    db: AsyncSession, user: CurrentUser, habit_id: int
) -> Habit:
    habit = await db.get(Habit, habit_id)
    if (
        habit is None
        or habit.deleted_at is not None
        or habit.user_id != user.id
        or habit.role_id != user.role_id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alışkanlık bulunamadı")
    return habit


async def _counts_for(
    db: AsyncSession, habit_id: int
) -> dict[datetime.date, int]:
    rows = await db.execute(
        select(HabitEntry.entry_date, HabitEntry.count).where(
            HabitEntry.habit_id == habit_id
        )
    )
    return {d: c for d, c in rows.all()}


# ── CRUD ─────────────────────────────────────────────────────────
async def list_habits(
    db: AsyncSession, user: CurrentUser, today: datetime.date
) -> list[Habit]:
    habits = list(
        (
            await db.execute(
                select(Habit)
                .where(
                    Habit.user_id == user.id,
                    Habit.role_id == user.role_id,
                    Habit.deleted_at.is_(None),
                )
                .order_by(Habit.position.asc(), Habit.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    if not habits:
        return habits

    ids = [h.id for h in habits]
    rows = await db.execute(
        select(
            HabitEntry.habit_id, HabitEntry.entry_date, HabitEntry.count
        ).where(HabitEntry.habit_id.in_(ids))
    )
    by_habit: dict[int, dict[datetime.date, int]] = defaultdict(dict)
    for hid, d, c in rows.all():
        by_habit[hid][d] = c

    for h in habits:
        _attach_stats(h, by_habit.get(h.id, {}), today)
    return habits


async def create_habit(
    db: AsyncSession, user: CurrentUser, data: HabitCreate
) -> Habit:
    habit = Habit(
        user_id=user.id,
        role_id=user.role_id,
        name=data.name.strip(),
        color=(data.color or "").strip() or None,
        icon=(data.icon or "").strip() or None,
        period=data.period.value,
        target_per_period=data.target_per_period,
    )
    db.add(habit)
    await db.flush()
    await db.refresh(habit)
    _attach_stats(habit, {}, datetime.date.today())
    return habit


async def update_habit(
    db: AsyncSession, user: CurrentUser, habit_id: int, data: HabitUpdate
) -> Habit:
    habit = await _owned_or_404(db, user, habit_id)
    payload = data.model_dump(exclude_unset=True)
    if payload.get("name"):
        habit.name = payload["name"].strip()
    if "color" in payload:
        habit.color = (payload["color"] or "").strip() or None
    if "icon" in payload:
        habit.icon = (payload["icon"] or "").strip() or None
    if payload.get("period") is not None:
        habit.period = data.period.value
    if payload.get("target_per_period") is not None:
        habit.target_per_period = payload["target_per_period"]
    await db.flush()
    _attach_stats(habit, await _counts_for(db, habit.id), datetime.date.today())
    return habit


async def delete_habit(
    db: AsyncSession, user: CurrentUser, habit_id: int
) -> None:
    habit = await _owned_or_404(db, user, habit_id)
    habit.deleted_at = _now()
    await db.flush()


# ── Kayıt (check-in) ─────────────────────────────────────────────
async def check_in(
    db: AsyncSession,
    user: CurrentUser,
    habit_id: int,
    entry_date: datetime.date,
    delta: int,
    today: datetime.date,
) -> Habit:
    habit = await _owned_or_404(db, user, habit_id)

    entry = await db.scalar(
        select(HabitEntry).where(
            HabitEntry.habit_id == habit_id,
            HabitEntry.entry_date == entry_date,
        )
    )
    new_count = (entry.count if entry else 0) + delta
    new_count = max(0, min(_MAX_COUNT, new_count))

    if new_count == 0:
        if entry is not None:
            await db.delete(entry)
    elif entry is not None:
        entry.count = new_count
    else:
        db.add(
            HabitEntry(habit_id=habit_id, entry_date=entry_date, count=new_count)
        )
    await db.flush()

    _attach_stats(habit, await _counts_for(db, habit.id), today)
    return habit
