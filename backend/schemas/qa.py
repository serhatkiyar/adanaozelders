from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, Field

from models.qa import QAStatus


class QAThreadCreate(BaseModel):
    booking_id: int
    subject: str | None = Field(default=None, max_length=150)
    question: str = Field(min_length=1)


class QAAnswer(BaseModel):
    answer: str = Field(min_length=1)


class QAMessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class QAMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sender_role: str
    body: str
    created_at: datetime.datetime


class QAThreadOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    client_id: int
    tutor_id: int
    booking_id: int | None = None
    subject: str | None = None
    question: str
    answer: str | None = None
    status: QAStatus
    answered_at: datetime.datetime | None = None
    created_at: datetime.datetime
    messages: list[QAMessageOut] = []
    # Görüntüleme için; list_threads/get_thread doldurur.
    tutor_name: str | None = None
    client_name: str | None = None


class LessonQuestionGroup(BaseModel):
    """Bir derse (booking) ait soru hakları + o derste sorulmuş sorular."""

    booking_id: int
    tutor_id: int
    tutor_name: str | None = None
    tutor_headline: str | None = None
    start_at: datetime.datetime
    end_at: datetime.datetime
    quota: int
    used: int
    remaining: int
    can_ask: bool
    expired: bool
    days_left: int
    threads: list[QAThreadOut]
