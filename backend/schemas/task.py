from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, Field


# ── Etiketler ────────────────────────────────────────────────────
class LabelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    color: str | None = Field(default=None, max_length=20)


class LabelUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    color: str | None = Field(default=None, max_length=20)


class LabelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    color: str | None = None


# ── Listeler / projeler ──────────────────────────────────────────
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
    is_inbox: bool = False
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
    priority: int = Field(default=4, ge=1, le=4)
    due_at: datetime.datetime | None = None
    recurrence: str | None = Field(default=None, max_length=30)
    booking_id: int | None = None
    label_ids: list[int] | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    priority: int | None = Field(default=None, ge=1, le=4)
    due_at: datetime.datetime | None = None
    recurrence: str | None = Field(default=None, max_length=30)
    booking_id: int | None = None
    label_ids: list[int] | None = None
    # Görevi başka bir listeye taşımak için.
    list_id: int | None = None


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    list_id: int
    title: str
    description: str | None = None
    priority: int
    due_at: datetime.datetime | None = None
    recurrence: str | None = None
    completed_at: datetime.datetime | None = None
    position: int = 0
    booking_id: int | None = None
    subtasks: list[SubtaskOut] = []
    labels: list[LabelOut] = []
    created_at: datetime.datetime


# ── Sıralama (sürükle-bırak) ─────────────────────────────────────
class ReorderIn(BaseModel):
    ids: list[int] = Field(min_length=1)
