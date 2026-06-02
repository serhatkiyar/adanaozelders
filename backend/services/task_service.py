from __future__ import annotations

import calendar
import datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUser
from core.config import settings
from models.booking import Booking
from models.role import ROLE_IDS, RoleType
from models.task import (
    Subtask,
    Task,
    TaskFilter,
    TaskLabel,
    TaskList,
    task_label_links,
)
from services import notification_service
from schemas.task import (
    LabelCreate,
    LabelUpdate,
    SubtaskCreate,
    SubtaskUpdate,
    TaskCreate,
    TaskFilterCreate,
    TaskFilterUpdate,
    TaskListCreate,
    TaskListUpdate,
    TaskUpdate,
)

INBOX_NAME = "Gelen Kutusu"
_RECURRENCE_RULES = {"daily", "weekly", "weekdays", "monthly", "yearly"}
_DUE_GROUPS = {"overdue", "today", "upcoming", "none"}
_FILTER_SORTS = {"smart", "due", "priority", "alpha"}


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


def task_reminder_message(title: str, overdue: bool) -> str:
    """Son tarih hatırlatma bildirimi metni (saf; testlenebilir)."""
    if overdue:
        return f"Görev gecikti: {title}"
    return f"Görev son tarihi yaklaşıyor: {title}"


# ── Kayıtlı filtre kriter normalizasyonu (saf; testlenebilir) ──────
def normalize_criteria(raw: dict | None) -> dict:
    """Kayıtlı filtre kriterlerini güvenli/kanonik bir sözlüğe indirger:
    bilinmeyen değerleri eler, tekrarları temizler, sıra korunur. İstemciden
    ne gelirse gelsin tutarlı bir şekil garanti eder (saf fonksiyon)."""
    raw = raw or {}
    q = (raw.get("q") or "").strip() or None

    priorities: list[int] = []
    for value in raw.get("priorities") or []:
        try:
            num = int(value)
        except (TypeError, ValueError):
            continue
        if 1 <= num <= 4 and num not in priorities:
            priorities.append(num)

    label_ids: list[int] = []
    for value in raw.get("label_ids") or []:
        try:
            num = int(value)
        except (TypeError, ValueError):
            continue
        if num not in label_ids:
            label_ids.append(num)

    due: list[str] = []
    for value in raw.get("due") or []:
        if value in _DUE_GROUPS and value not in due:
            due.append(value)

    sort = raw.get("sort")
    if sort not in _FILTER_SORTS:
        sort = "smart"

    return {
        "q": q,
        "priorities": priorities,
        "label_ids": label_ids,
        "due": due,
        "sort": sort,
    }


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
    """Kullanıcının varsayılan 'Gelen Kutusu' listesini döner; yoksa oluşturur.

    Açılışta birden çok endpoint (lists/tasks/labels) paralel çağrıldığından,
    inbox yokken birkaç istek aynı anda oluşturup MÜKERRER satır bırakabilir.
    Bu yüzden ``scalar_one_or_none`` yerine tüm inbox'ları okur, en küçük id'yi
    tutar ve fazlalıkları soft-delete eder (kendi kendini onarır)."""
    inboxes = list(
        (
            await db.execute(
                select(TaskList)
                .where(
                    TaskList.user_id == user.id,
                    TaskList.role_id == user.role_id,
                    TaskList.is_inbox.is_(True),
                    TaskList.deleted_at.is_(None),
                )
                .order_by(TaskList.id.asc())
            )
        ).scalars().all()
    )
    if inboxes:
        if len(inboxes) > 1:
            # Yarış koşulu artığı: fazlalık inbox'ları temizle.
            for extra in inboxes[1:]:
                extra.deleted_at = _now()
            await db.flush()
        return inboxes[0]

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
    if payload.get("is_favorite") is not None:
        task_list.is_favorite = payload["is_favorite"]
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
    if payload.get("is_favorite") is not None:
        label.is_favorite = payload["is_favorite"]
    await db.flush()
    return label


async def delete_label(db: AsyncSession, user: CurrentUser, label_id: int) -> None:
    label = await _owned_label_or_404(db, user, label_id)
    label.deleted_at = _now()
    await db.flush()


# ── Kayıtlı filtreler ────────────────────────────────────────────
async def _owned_filter_or_404(
    db: AsyncSession, user: CurrentUser, filter_id: int
) -> TaskFilter:
    flt = await db.get(TaskFilter, filter_id)
    if (
        flt is None
        or flt.deleted_at is not None
        or flt.user_id != user.id
        or flt.role_id != user.role_id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Filtre bulunamadı")
    return flt


async def list_filters(db: AsyncSession, user: CurrentUser) -> list[TaskFilter]:
    return list(
        (
            await db.execute(
                select(TaskFilter)
                .where(
                    TaskFilter.user_id == user.id,
                    TaskFilter.role_id == user.role_id,
                    TaskFilter.deleted_at.is_(None),
                )
                .order_by(TaskFilter.position.asc(), TaskFilter.created_at.asc())
            )
        ).scalars().all()
    )


async def create_filter(
    db: AsyncSession, user: CurrentUser, data: TaskFilterCreate
) -> TaskFilter:
    max_pos = (
        await db.execute(
            select(func.coalesce(func.max(TaskFilter.position), -1)).where(
                TaskFilter.user_id == user.id,
                TaskFilter.role_id == user.role_id,
                TaskFilter.deleted_at.is_(None),
            )
        )
    ).scalar_one()
    flt = TaskFilter(
        user_id=user.id,
        role_id=user.role_id,
        name=data.name.strip(),
        color=(data.color or "").strip() or None,
        criteria=normalize_criteria(data.criteria.model_dump()),
        is_favorite=data.is_favorite,
        position=int(max_pos) + 1,
    )
    db.add(flt)
    await db.flush()
    await db.refresh(flt)
    return flt


async def update_filter(
    db: AsyncSession, user: CurrentUser, filter_id: int, data: TaskFilterUpdate
) -> TaskFilter:
    flt = await _owned_filter_or_404(db, user, filter_id)
    payload = data.model_dump(exclude_unset=True)
    if payload.get("name"):
        flt.name = payload["name"].strip()
    if "color" in payload:
        flt.color = (payload["color"] or "").strip() or None
    if payload.get("criteria") is not None:
        flt.criteria = normalize_criteria(payload["criteria"])
    if payload.get("is_favorite") is not None:
        flt.is_favorite = payload["is_favorite"]
    await db.flush()
    await db.refresh(flt)
    return flt


async def delete_filter(
    db: AsyncSession, user: CurrentUser, filter_id: int
) -> None:
    flt = await _owned_filter_or_404(db, user, filter_id)
    flt.deleted_at = _now()
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


async def _ancestor_ids(db: AsyncSession, start_id: int | None) -> set[int]:
    """``start_id``'den köke kadar ata görev id'leri (start dahil). Döngü/aşırı
    derinliğe karşı korumalı."""
    ids: set[int] = set()
    cur = start_id
    for _ in range(200):
        if cur is None or cur in ids:
            break
        ids.add(cur)
        node = await db.get(Task, cur)
        if node is None:
            break
        cur = node.parent_id
    return ids


async def _cascade_subtree_list(
    db: AsyncSession, root_id: int, list_id: int
) -> None:
    """Bir görevin tüm (alt) alt görevlerini aynı listeye taşır — alt görev
    üst görevle aynı projede yaşar."""
    frontier = [root_id]
    seen: set[int] = set()
    while frontier:
        pid = frontier.pop()
        if pid in seen:
            continue
        seen.add(pid)
        children = list(
            (
                await db.execute(
                    select(Task).where(
                        Task.parent_id == pid, Task.deleted_at.is_(None)
                    )
                )
            ).scalars().all()
        )
        for child in children:
            child.list_id = list_id
            frontier.append(child.id)


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
        task.reminder_sent = False  # yeni son tarih -> yeniden hatırlat
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
        await _cascade_subtree_list(db, task.id, task.list_id)
    # Üst görev (alt görev yapma / üst seviyeye çıkarma).
    if "parent_id" in payload:
        new_parent = payload["parent_id"]
        if new_parent is None:
            task.parent_id = None
        else:
            if new_parent == task.id:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, "Görev kendi alt görevi olamaz"
                )
            parent = await _owned_task_or_404(db, user, new_parent)
            # Döngü: yeni üst, bu görevin altındaysa reddet.
            if task.id in await _ancestor_ids(db, new_parent):
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "Bir görev kendi alt görevinin altına taşınamaz",
                )
            task.parent_id = new_parent
            # Alt görev üst görevle aynı listede yaşar (alt-ağaç dahil).
            if task.list_id != parent.list_id:
                task.list_id = parent.list_id
                await _cascade_subtree_list(db, task.id, parent.list_id)
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
                task.reminder_sent = False  # sonraki oluşum için yeniden hatırlat
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


# ── Son tarih hatırlatmaları (arka plan döngüsü) ─────────────────
async def send_task_due_reminders(db: AsyncSession) -> int:
    """Son tarihi yaklaşan (lead penceresi içinde) veya geçmiş ama henüz
    hatırlatılmamış aktif görevler için sahibine bir kez bildirim gönderir.
    Booking ``send_due_reminders`` deseniyle aynı; ``main._reminder_loop``
    içinde periyodik çağrılır."""
    now = _now()
    lead = now + datetime.timedelta(minutes=settings.TASK_REMINDER_LEAD_MINUTES)
    rows = (
        await db.execute(
            select(Task, TaskList.user_id, TaskList.role_id)
            .join(TaskList, Task.list_id == TaskList.id)
            .where(
                Task.deleted_at.is_(None),
                Task.completed_at.is_(None),
                Task.reminder_sent.is_(False),
                Task.due_at.is_not(None),
                Task.due_at <= lead,
                TaskList.deleted_at.is_(None),
            )
        )
    ).all()
    for task, user_id, role_id in rows:
        overdue = task.due_at is not None and task.due_at < now
        await notification_service.notify(
            db,
            user_id=user_id,
            role_id=role_id,
            message=task_reminder_message(task.title, overdue),
            link="/panel/gorevler",
        )
        task.reminder_sent = True
    return len(rows)
