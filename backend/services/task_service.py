from __future__ import annotations

import calendar
import datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUser
from models.booking import Booking
from models.role import ROLE_IDS, RoleType
from models.task import Subtask, Task, TaskLabel, TaskList, task_label_links
from schemas.task import (
    LabelCreate,
    LabelUpdate,
    SubtaskCreate,
    SubtaskUpdate,
    TaskCreate,
    TaskListCreate,
    TaskListUpdate,
    TaskUpdate,
)

INBOX_NAME = "Gelen Kutusu"
_RECURRENCE_RULES = {"daily", "weekly", "weekdays", "monthly", "yearly"}


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


# ── Akıllı görünüm sınıflandırması (saf; testlenebilir) ─────────────
def classify_due(
    due_at: datetime.datetime | None,
    now: datetime.datetime,
) -> str | None:
    """Bir görevin son tarihini "overdue" / "today" / "upcoming" olarak
    sınıflandırır. Son tarihi yoksa None döner."""
    if due_at is None:
        return None
    if due_at < now:
        return "overdue"
    if due_at.date() == now.date():
        return "today"
    return "upcoming"


# ── Tekrar (recurrence) bir sonraki tarih (saf; testlenebilir) ──────
def _add_month(d: datetime.datetime) -> datetime.datetime:
    year = d.year + (1 if d.month == 12 else 0)
    month = 1 if d.month == 12 else d.month + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return d.replace(year=year, month=month, day=day)


def compute_next_due(
    rule: str | None, base: datetime.datetime
) -> datetime.datetime | None:
    """Tekrar kuralına göre ``base``'ten sonraki bir oluşum tarihini döner.
    Bilinmeyen/boş kural -> None. Saf fonksiyon."""
    if not rule:
        return None
    rule = rule.strip().lower()
    if rule == "daily":
        return base + datetime.timedelta(days=1)
    if rule == "weekly":
        return base + datetime.timedelta(days=7)
    if rule == "weekdays":
        nxt = base + datetime.timedelta(days=1)
        while nxt.weekday() >= 5:  # 5=Cmt, 6=Pzr
            nxt += datetime.timedelta(days=1)
        return nxt
    if rule == "monthly":
        return _add_month(base)
    if rule == "yearly":
        return base.replace(year=base.year + 1)
    return None


def _normalize_recurrence(value: str | None) -> str | None:
    if not value:
        return None
    v = value.strip().lower()
    return v if v in _RECURRENCE_RULES else None


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


async def _owned_label_or_404(
    db: AsyncSession, user: CurrentUser, label_id: int
) -> TaskLabel:
    label = await db.get(TaskLabel, label_id)
    if (
        label is None
        or label.deleted_at is not None
        or label.user_id != user.id
        or label.role_id != user.role_id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Etiket bulunamadı")
    return label


async def _resolve_labels(
    db: AsyncSession, user: CurrentUser, label_ids: list[int] | None
) -> list[TaskLabel]:
    if not label_ids:
        return []
    rows = list(
        (
            await db.execute(
                select(TaskLabel).where(
                    TaskLabel.id.in_(label_ids),
                    TaskLabel.user_id == user.id,
                    TaskLabel.role_id == user.role_id,
                    TaskLabel.deleted_at.is_(None),
                )
            )
        ).scalars().all()
    )
    if len(rows) != len(set(label_ids)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Etiket bulunamadı")
    return rows


async def _validate_booking(
    db: AsyncSession, user: CurrentUser, booking_id: int | None
) -> None:
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


# ── Gelen Kutusu (Inbox) ─────────────────────────────────────────
async def ensure_inbox(db: AsyncSession, user: CurrentUser) -> TaskList:
    """Kullanıcının varsayılan 'Gelen Kutusu' listesini döner; yoksa oluşturur."""
    inbox = (
        await db.execute(
            select(TaskList).where(
                TaskList.user_id == user.id,
                TaskList.role_id == user.role_id,
                TaskList.is_inbox.is_(True),
                TaskList.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if inbox is None:
        inbox = TaskList(
            user_id=user.id,
            role_id=user.role_id,
            name=INBOX_NAME,
            is_inbox=True,
            position=-1,  # her zaman en üstte
        )
        db.add(inbox)
        await db.flush()
        await db.refresh(inbox)
    return inbox


# ── Listeler ─────────────────────────────────────────────────────
async def _attach_counts(db: AsyncSession, lists: list[TaskList]) -> None:
    if not lists:
        return
    now = _now()
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


async def list_lists(db: AsyncSession, user: CurrentUser) -> list[TaskList]:
    await ensure_inbox(db, user)
    lists = list(
        (
            await db.execute(
                select(TaskList)
                .where(
                    TaskList.user_id == user.id,
                    TaskList.role_id == user.role_id,
                    TaskList.deleted_at.is_(None),
                )
                .order_by(
                    TaskList.is_inbox.desc(),
                    TaskList.position.asc(),
                    TaskList.created_at.asc(),
                )
            )
        ).scalars().all()
    )
    await _attach_counts(db, lists)
    return lists


async def create_list(
    db: AsyncSession, user: CurrentUser, data: TaskListCreate
) -> TaskList:
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
    await _attach_counts(db, [task_list])
    return task_list


async def delete_list(db: AsyncSession, user: CurrentUser, list_id: int) -> None:
    task_list = await _owned_list_or_404(db, user, list_id)
    if task_list.is_inbox:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Gelen Kutusu silinemez"
        )
    task_list.deleted_at = _now()
    await db.flush()


async def reorder_lists(
    db: AsyncSession, user: CurrentUser, ids: list[int]
) -> None:
    for index, list_id in enumerate(ids):
        task_list = await _owned_list_or_404(db, user, list_id)
        task_list.position = index
    await db.flush()


# ── Etiketler ────────────────────────────────────────────────────
async def list_labels(db: AsyncSession, user: CurrentUser) -> list[TaskLabel]:
    return list(
        (
            await db.execute(
                select(TaskLabel)
                .where(
                    TaskLabel.user_id == user.id,
                    TaskLabel.role_id == user.role_id,
                    TaskLabel.deleted_at.is_(None),
                )
                .order_by(TaskLabel.name.asc())
            )
        ).scalars().all()
    )


async def create_label(
    db: AsyncSession, user: CurrentUser, data: LabelCreate
) -> TaskLabel:
    name = data.name.strip()
    existing = (
        await db.execute(
            select(TaskLabel).where(
                TaskLabel.user_id == user.id,
                TaskLabel.role_id == user.role_id,
                func.lower(TaskLabel.name) == name.lower(),
                TaskLabel.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    label = TaskLabel(
        user_id=user.id,
        role_id=user.role_id,
        name=name,
        color=(data.color or "").strip() or None,
    )
    db.add(label)
    await db.flush()
    await db.refresh(label)
    return label


async def update_label(
    db: AsyncSession, user: CurrentUser, label_id: int, data: LabelUpdate
) -> TaskLabel:
    label = await _owned_label_or_404(db, user, label_id)
    payload = data.model_dump(exclude_unset=True)
    if payload.get("name"):
        label.name = payload["name"].strip()
    if "color" in payload:
        label.color = (payload["color"] or "").strip() or None
    await db.flush()
    return label


async def delete_label(db: AsyncSession, user: CurrentUser, label_id: int) -> None:
    label = await _owned_label_or_404(db, user, label_id)
    label.deleted_at = _now()
    await db.flush()


# ── Görevler ─────────────────────────────────────────────────────
def _task_query():
    return select(Task).options(
        selectinload(Task.subtasks), selectinload(Task.labels)
    )


async def list_tasks(
    db: AsyncSession,
    user: CurrentUser,
    *,
    list_id: int | None,
    status_filter: str,
    booking_id: int | None = None,
    label_id: int | None = None,
) -> list[Task]:
    """Görevleri döndürür. ``list_id`` o listeyle, ``booking_id`` o derse,
    ``label_id`` o etikete sınırlar; hiçbiri yoksa kullanıcının tüm listelerini
    kapsar (akıllı görünümler). ``status_filter``: active | completed | all."""
    if list_id is not None:
        await _owned_list_or_404(db, user, list_id)
        list_ids = [list_id]
    else:
        await ensure_inbox(db, user)
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
    if label_id is not None:
        stmt = stmt.where(
            Task.id.in_(
                select(task_label_links.c.task_id).where(
                    task_label_links.c.label_id == label_id
                )
            )
        )
    if status_filter == "active":
        stmt = stmt.where(Task.completed_at.is_(None))
    elif status_filter == "completed":
        stmt = stmt.where(Task.completed_at.is_not(None))
    stmt = stmt.order_by(
        Task.completed_at.is_(None).desc(),
        Task.position.asc(),
        Task.due_at.is_(None).asc(),
        Task.due_at.asc(),
        Task.created_at.desc(),
    )
    return list((await db.execute(stmt)).scalars().all())


async def create_task(
    db: AsyncSession, user: CurrentUser, list_id: int, data: TaskCreate
) -> Task:
    await _owned_list_or_404(db, user, list_id)
    await _validate_booking(db, user, data.booking_id)
    labels = await _resolve_labels(db, user, data.label_ids)
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
        recurrence=_normalize_recurrence(data.recurrence),
        booking_id=data.booking_id,
        position=int(max_pos) + 1,
    )
    task.labels = labels
    db.add(task)
    await db.flush()
    await db.refresh(task, attribute_names=["subtasks", "labels"])
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
    if "recurrence" in payload:
        task.recurrence = _normalize_recurrence(payload["recurrence"])
    if "booking_id" in payload:
        await _validate_booking(db, user, payload["booking_id"])
        task.booking_id = payload["booking_id"]
    if "label_ids" in payload:
        task.labels = await _resolve_labels(db, user, payload["label_ids"])
    if payload.get("list_id") is not None and payload["list_id"] != task.list_id:
        await _owned_list_or_404(db, user, payload["list_id"])
        task.list_id = payload["list_id"]
    await db.flush()
    await db.refresh(task, attribute_names=["subtasks", "labels"])
    return task


async def toggle_task(
    db: AsyncSession, user: CurrentUser, task_id: int
) -> Task:
    task = await _owned_task_or_404(db, user, task_id)
    if task.completed_at is None:
        # Tamamlanıyor. Tekrarlayan + son tarihli görev tamamlanmaz; bir sonraki
        # oluşuma (şimdiden ileriye) yuvarlanır ve aktif kalır (Todoist davranışı).
        if task.recurrence and task.due_at is not None:
            now = _now()
            nxt = compute_next_due(task.recurrence, task.due_at)
            guard = 0
            while nxt is not None and nxt <= now and guard < 1000:
                nxt = compute_next_due(task.recurrence, nxt)
                guard += 1
            if nxt is not None:
                task.due_at = nxt
                await db.flush()
                await db.refresh(task, attribute_names=["subtasks", "labels"])
                return task
        task.completed_at = _now()
    else:
        task.completed_at = None
    await db.flush()
    await db.refresh(task, attribute_names=["subtasks", "labels"])
    return task


async def delete_task(db: AsyncSession, user: CurrentUser, task_id: int) -> None:
    task = await _owned_task_or_404(db, user, task_id)
    task.deleted_at = _now()
    await db.flush()


async def reorder_tasks(
    db: AsyncSession, user: CurrentUser, ids: list[int]
) -> None:
    for index, task_id in enumerate(ids):
        task = await _owned_task_or_404(db, user, task_id)
        task.position = index
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
