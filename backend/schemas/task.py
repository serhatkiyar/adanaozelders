from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, Field

from models.task import TaskPriority


# ── Listeler ─────────────────────────────────────────────────────
class TaskListCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    color: str | None = Field(default=None, max_length=20)


class TaskListUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    color: str | None = Field(default=None, max_length=20)


class TaskListOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    color: str | None = None
    position: int = 0
    active_count: int = 0
    overdue_count: int = 0
    created_at: datetime.datetime


# ── Alt görevler ─────────────────────────────────────────────────
class SubtaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class SubtaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    is_done: bool | None = None


class SubtaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: int
    title: str
    is_done: bool
    position: int = 0


# ── Görevler ─────────────────────────────────────────────────────
class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    priority: TaskPriority = TaskPriority.MEDIUM
    due_at: datetime.datetime | None = None
    booking_id: int | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    priority: TaskPriority | None = None
    due_at: datetime.datetime | None = None
    booking_id: int | None = None
    # Görevi başka bir listeye taşımak için.
    list_id: int | None = None


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    list_id: int
    title: str
    description: str | None = None
    priority: TaskPriority
    due_at: datetime.datetime | None = None
    completed_at: datetime.datetime | None = None
    position: int = 0
    booking_id: int | None = None
    subtasks: list[SubtaskOut] = []
    created_at: datetime.datetime
