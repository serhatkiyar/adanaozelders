from __future__ import annotations

import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class ExamSubjectCreate(BaseModel):
    subject: str = Field(min_length=1, max_length=100)
    correct_count: int = Field(ge=0)
    wrong_count: int = Field(ge=0)
    blank_count: int = Field(default=0, ge=0)


class ExamSubjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    subject: str
    correct_count: int
    wrong_count: int
    blank_count: int
    net_score: Decimal | None = None


class PracticeExamCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    exam_type: str | None = Field(default=None, max_length=50)
    exam_date: datetime.date | None = None
    tutor_id: int | None = None
    # Konu bazlı kırılım verilirse totaller bundan toplanır; verilmezse aşağıdaki
    # tekil sayımlar kullanılır (geriye dönük uyumlu).
    subjects: list[ExamSubjectCreate] = Field(default_factory=list)
    correct_count: int = Field(default=0, ge=0)
    wrong_count: int = Field(default=0, ge=0)
    blank_count: int = Field(default=0, ge=0)
    wrong_penalty: float = Field(default=4.0, gt=0)


class PracticeExamOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    client_id: int
    tutor_id: int | None = None
    title: str
    exam_type: str | None = None
    exam_date: datetime.date | None = None
    correct_count: int
    wrong_count: int
    blank_count: int
    net_score: Decimal | None = None
    created_at: datetime.datetime
    subjects: list[ExamSubjectOut] = []
