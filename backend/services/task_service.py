from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUser
from models.booking import Booking
from models.role import ROLE_IDS, RoleType
from models.task import Subtask, Task, TaskList
from schemas.task import (
    SubtaskCreate,
    SubtaskUpdate,
    TaskCreate,
    TaskListCreate,
    TaskListUpdate,
    TaskUpdate,
)


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


# ── Akıllı görünüm sınıflandırması (saf; testlenebilir) ─────────────
def classify_due(
    due_at: datetime.datetime | None,
    now: datetime.datetime,
) -> str | None:
    """Bir görevin son tarihini "overdue" / "today" / "upcoming" olarak
    sınıflandırır. Son tarihi yoksa None döner. "today" yerel değil UTC gün
    sınırına göre değil, *now* ile aynı takvim gününe göre belirlenir
    (frontend yerel tarihe göre yeniden gruplayabilir; bu, sunucu tarafı
    filtreleme/kota için yeterli kaba sınıflandırmadır)."""
    if due_at is None:
        return None
    if due_at < now:
        return "overdue"
    if due_at.date() == now.date():
        return "today"
    return "upcoming"


# ── Sahiplik yardımcıları ────────────────────────────────────────
async def _owned_list_or_404(
    db: AsyncSession, user: CurrentUser, list_id: int
) -> TaskList:
    task_list = await db.get(TaskList, list_id)
    if (
        task_list is None
        or task_list.deleted_at is not None
        or task_list.user_id != user.id
        or task_list.role_id != user.role_id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Liste bulunamadı")
    return task_list


async def _owned_task_or_404(
    db: AsyncSession, user: CurrentUser, task_id: int
) -> Task:
    task = await db.get(Task, task_id)
    if task is None or task.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Görev bulunamadı")
    await _owned_list_or_404(db, user, task.list_id)
    return task


async def _owned_subtask_or_404(
    db: AsyncSession, user: CurrentUser, subtask_id: int
) -> Subtask:
    subtask = await db.get(Subtask, subtask_id)
    if subtask is None or subtask.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alt görev bulunamadı")
    await _owned_task_or_404(db, user, subtask.task_id)
    return subtask


async def _validate_booking(
    db: AsyncSession, user: CurrentUser, booking_id: int | None
) -> None:
    """Görev bir derse bağlanıyorsa, dersin kullanıcıya ait olduğunu doğrular."""
    if booking_id is None:
        return
    booking = await db.get(Booking, booking_id)
    if booking is None or booking.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ders bulunamadı")
    is_client = (
        user.role_id == ROLE_IDS[RoleType.CLIENT]
        and booking.client_id == user.id
    )
    is_tutor = (
        user.role_id == ROLE_IDS[RoleType.TUTOR]
        and booking.tutor_id == user.id
    )
    if not (is_client or is_tutor):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Bu ders size ait değil")


# ── Listeler ─────────────────────────────────────────────────────
async def list_lists(db: AsyncSession, user: CurrentUser) -> list[TaskList]:
    now = _now()
    lists = list(
        (
            await db.execute(
                select(TaskList)
                .where(
                    TaskList.user_id == user.id,
                    TaskList.role_id == user.role_id,
                    TaskList.deleted_at.is_(None),
                )
                .order_by(TaskList.position.asc(), TaskList.created_at.asc())
            )
        ).scalars().all()
    )
    if not lists:
        return lists
    ids = [lst.id for lst in lists]

    actives = dict(
        (
            await db.execute(
                select(Task.list_id, func.count())
                .where(
                    Task.list_id.in_(ids),
                    Task.deleted_at.is_(None),
                    Task.completed_at.is_(None),
                )
                .group_by(Task.list_id)
            )
        ).all()
    )
    overdues = dict(
        (
            await db.execute(
                select(Task.list_id, func.count())
                .where(
                    Task.list_id.in_(ids),
                    Task.deleted_at.is_(None),
                    Task.completed_at.is_(None),
                    Task.due_at.is_not(None),
                    Task.due_at < now,
                )
                .group_by(Task.list_id)
            )
        ).all()
    )
    for lst in lists:
        lst.active_count = int(actives.get(lst.id, 0))
        lst.overdue_count = int(overdues.get(lst.id, 0))
    return lists


async def create_list(
    db: AsyncSession, user: CurrentUser, data: TaskListCreate
) -> TaskList:
    # Yeni listeyi sona ekle.
    max_pos = (
        await db.execute(
            select(func.coalesce(func.max(TaskList.position), -1)).where(
                TaskList.user_id == user.id,
                TaskList.role_id == user.role_id,
                TaskList.deleted_at.is_(None),
            )
        )
    ).scalar_one()
    task_list = TaskList(
        user_id=user.id,
        role_id=user.role_id,
        name=data.name.strip(),
        color=(data.color or "").strip() or None,
        position=int(max_pos) + 1,
    )
    db.add(task_list)
    await db.flush()
    await db.refresh(task_list)
    task_list.active_count = 0
    task_list.overdue_count = 0
    return task_list


async def update_list(
    db: AsyncSession, user: CurrentUser, list_id: int, data: TaskListUpdate
) -> TaskList:
    task_list = await _owned_list_or_404(db, user, list_id)
    payload = data.model_dump(exclude_unset=True)
    if payload.get("name"):
        task_list.name = payload["name"].strip()
    if "color" in payload:
        task_list.color = (payload["color"] or "").strip() or None
    await db.flush()
    return task_list


async def delete_list(db: AsyncSession, user: CurrentUser, list_id: int) -> None:
    task_list = await _owned_list_or_404(db, user, list_id)
    task_list.deleted_at = _now()
    await db.flush()


# ── Görevler ─────────────────────────────────────────────────────
def _task_query():
    return select(Task).options(selectinload(Task.subtasks))


async def list_tasks(
    db: AsyncSession,
    user: CurrentUser,
    *,
    list_id: int | None,
    status_filter: str,
    booking_id: int | None = None,
) -> list[Task]:
    """Görevleri döndürür. ``list_id`` verilirse o listeyle sınırlar, aksi halde
    kullanıcının tüm listelerini kapsar (akıllı görünümler için). ``booking_id``
    verilirse yalnız o derse bağlı görevler döner. ``status_filter``:
    active | completed | all."""
    if list_id is not None:
        await _owned_list_or_404(db, user, list_id)
        list_ids = [list_id]
    else:
        list_ids = list(
            (
                await db.execute(
                    select(TaskList.id).where(
                        TaskList.user_id == user.id,
                        TaskList.role_id == user.role_id,
                        TaskList.deleted_at.is_(None),
                    )
                )
            ).scalars().all()
        )
        if not list_ids:
            return []

    stmt = _task_query().where(
        Task.list_id.in_(list_ids), Task.deleted_at.is_(None)
    )
    if booking_id is not None:
        stmt = stmt.where(Task.booking_id == booking_id)
    if status_filter == "active":
        stmt = stmt.where(Task.completed_at.is_(None))
    elif status_filter == "completed":
        stmt = stmt.where(Task.completed_at.is_not(None))
    # Aktif görevler önce (tamamlananlar sona), son tarihe ve pozisyona göre.
    stmt = stmt.order_by(
        Task.completed_at.is_(None).desc(),
        Task.due_at.is_(None).asc(),
        Task.due_at.asc(),
        Task.position.asc(),
        Task.created_at.desc(),
    )
    return list((await db.execute(stmt)).scalars().all())


async def create_task(
    db: AsyncSession, user: CurrentUser, list_id: int, data: TaskCreate
) -> Task:
    await _owned_list_or_404(db, user, list_id)
    await _validate_booking(db, user, data.booking_id)
    max_pos = (
        await db.execute(
            select(func.coalesce(func.max(Task.position), -1)).where(
                Task.list_id == list_id, Task.deleted_at.is_(None)
            )
        )
    ).scalar_one()
    task = Task(
        list_id=list_id,
        title=data.title.strip(),
        description=(data.description or "").strip() or None,
        priority=data.priority,
        due_at=data.due_at,
        booking_id=data.booking_id,
        position=int(max_pos) + 1,
    )
    db.add(task)
    await db.flush()
    await db.refresh(task, attribute_names=["subtasks"])
    return task


async def update_task(
    db: AsyncSession, user: CurrentUser, task_id: int, data: TaskUpdate
) -> Task:
    task = await _owned_task_or_404(db, user, task_id)
    payload = data.model_dump(exclude_unset=True)
    if payload.get("title"):
        task.title = payload["title"].strip()
    if "description" in payload:
        task.description = (payload["description"] or "").strip() or None
    if payload.get("priority") is not None:
        task.priority = payload["priority"]
    if "due_at" in payload:
        task.due_at = payload["due_at"]
    if "booking_id" in payload:
        await _validate_booking(db, user, payload["booking_id"])
        task.booking_id = payload["booking_id"]
    if payload.get("list_id") is not None and payload["list_id"] != task.list_id:
        # Hedef listenin de kullanıcıya ait olduğunu doğrula.
        await _owned_list_or_404(db, user, payload["list_id"])
        task.list_id = payload["list_id"]
    await db.flush()
    await db.refresh(task, attribute_names=["subtasks"])
    return task


async def toggle_task(
    db: AsyncSession, user: CurrentUser, task_id: int
) -> Task:
    task = await _owned_task_or_404(db, user, task_id)
    task.completed_at = None if task.completed_at is not None else _now()
    await db.flush()
    await db.refresh(task, attribute_names=["subtasks"])
    return task


async def delete_task(db: AsyncSession, user: CurrentUser, task_id: int) -> None:
    task = await _owned_task_or_404(db, user, task_id)
    task.deleted_at = _now()
    await db.flush()


# ── Alt görevler ─────────────────────────────────────────────────
async def create_subtask(
    db: AsyncSession, user: CurrentUser, task_id: int, data: SubtaskCreate
) -> Subtask:
    await _owned_task_or_404(db, user, task_id)
    max_pos = (
        await db.execute(
            select(func.coalesce(func.max(Subtask.position), -1)).where(
                Subtask.task_id == task_id, Subtask.deleted_at.is_(None)
            )
        )
    ).scalar_one()
    subtask = Subtask(
        task_id=task_id,
        title=data.title.strip(),
        position=int(max_pos) + 1,
    )
    db.add(subtask)
    await db.flush()
    await db.refresh(subtask)
    return subtask


async def update_subtask(
    db: AsyncSession, user: CurrentUser, subtask_id: int, data: SubtaskUpdate
) -> Subtask:
    subtask = await _owned_subtask_or_404(db, user, subtask_id)
    payload = data.model_dump(exclude_unset=True)
    if payload.get("title"):
        subtask.title = payload["title"].strip()
    if payload.get("is_done") is not None:
        subtask.is_done = payload["is_done"]
    await db.flush()
    return subtask


async def delete_subtask(
    db: AsyncSession, user: CurrentUser, subtask_id: int
) -> None:
    subtask = await _owned_subtask_or_404(db, user, subtask_id)
    subtask.deleted_at = _now()
    await db.flush()
