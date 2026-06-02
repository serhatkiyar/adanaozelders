from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUser, get_current_active_user, user_rate_limit
from core.config import settings
from core.database import get_db
from schemas.task import (
    LabelCreate,
    LabelOut,
    LabelUpdate,
    ReorderIn,
    SubtaskCreate,
    SubtaskOut,
    SubtaskUpdate,
    TaskCreate,
    TaskFilterCreate,
    TaskFilterOut,
    TaskFilterUpdate,
    TaskListCreate,
    TaskListOut,
    TaskListUpdate,
    TaskOut,
    TaskUpdate,
)
from services import task_service

router = APIRouter(prefix="/tasks", tags=["tasks"])

_write_limit = user_rate_limit(
    key="task_write",
    limit=settings.RATE_LIMIT_TASK,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)


# ── Listeler / projeler ──────────────────────────────────────────
@router.get("/lists", response_model=list[TaskListOut])
async def list_lists(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.list_lists(db, user)


@router.post(
    "/lists",
    response_model=TaskListOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_write_limit)],
)
async def create_list(
    payload: TaskListCreate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.create_list(db, user, payload)


@router.post("/lists/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_lists(
    payload: ReorderIn,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await task_service.reorder_lists(db, user, payload.ids)


@router.patch("/lists/{list_id}", response_model=TaskListOut)
async def update_list(
    list_id: int,
    payload: TaskListUpdate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.update_list(db, user, list_id, payload)


@router.delete("/lists/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_list(
    list_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await task_service.delete_list(db, user, list_id)


# ── Etiketler ────────────────────────────────────────────────────
@router.get("/labels", response_model=list[LabelOut])
async def list_labels(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.list_labels(db, user)


@router.post(
    "/labels",
    response_model=LabelOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_write_limit)],
)
async def create_label(
    payload: LabelCreate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.create_label(db, user, payload)


@router.patch("/labels/{label_id}", response_model=LabelOut)
async def update_label(
    label_id: int,
    payload: LabelUpdate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.update_label(db, user, label_id, payload)


@router.delete("/labels/{label_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_label(
    label_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await task_service.delete_label(db, user, label_id)


# ── Kayıtlı filtreler ────────────────────────────────────────────
@router.get("/filters", response_model=list[TaskFilterOut])
async def list_filters(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.list_filters(db, user)


@router.post(
    "/filters",
    response_model=TaskFilterOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_write_limit)],
)
async def create_filter(
    payload: TaskFilterCreate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.create_filter(db, user, payload)


@router.patch("/filters/{filter_id}", response_model=TaskFilterOut)
async def update_filter(
    filter_id: int,
    payload: TaskFilterUpdate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.update_filter(db, user, filter_id, payload)


@router.delete("/filters/{filter_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_filter(
    filter_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await task_service.delete_filter(db, user, filter_id)


# ── Görevler ─────────────────────────────────────────────────────
@router.get("", response_model=list[TaskOut])
async def list_tasks(
    list_id: int | None = Query(default=None),
    booking_id: int | None = Query(default=None),
    label_id: int | None = Query(default=None),
    status_filter: str = Query(
        default="active", alias="status", pattern="^(active|completed|all)$"
    ),
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.list_tasks(
        db,
        user,
        list_id=list_id,
        status_filter=status_filter,
        booking_id=booking_id,
        label_id=label_id,
    )


@router.post(
    "/lists/{list_id}/tasks",
    response_model=TaskOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_write_limit)],
)
async def create_task(
    list_id: int,
    payload: TaskCreate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.create_task(db, user, list_id, payload)


@router.post("/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_tasks(
    payload: ReorderIn,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await task_service.reorder_tasks(db, user, payload.ids)


@router.patch("/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: int,
    payload: TaskUpdate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.update_task(db, user, task_id, payload)


@router.post("/{task_id}/toggle", response_model=TaskOut)
async def toggle_task(
    task_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.toggle_task(db, user, task_id)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await task_service.delete_task(db, user, task_id)


# ── Alt görevler ─────────────────────────────────────────────────
@router.post(
    "/{task_id}/subtasks",
    response_model=SubtaskOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_write_limit)],
)
async def create_subtask(
    task_id: int,
    payload: SubtaskCreate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.create_subtask(db, user, task_id, payload)


@router.patch("/subtasks/{subtask_id}", response_model=SubtaskOut)
async def update_subtask(
    subtask_id: int,
    payload: SubtaskUpdate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.update_subtask(db, user, subtask_id, payload)


@router.delete("/subtasks/{subtask_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_subtask(
    subtask_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await task_service.delete_subtask(db, user, subtask_id)
