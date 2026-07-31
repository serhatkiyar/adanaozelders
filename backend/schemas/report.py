from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from models.report import REPORT_TARGET_TYPES, ReportReason, ReportStatus


class ReportCreate(BaseModel):
    target_type: str = Field(min_length=1, max_length=30)
    target_id: int = Field(gt=0)
    reason: ReportReason
    description: str | None = Field(default=None, max_length=2000)

    @field_validator("target_type")
    @classmethod
    def _valid_target(cls, v: str) -> str:
        v = v.upper()
        if v not in REPORT_TARGET_TYPES:
            raise ValueError("Geçersiz şikayet hedefi")
        return v


class ReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    reporter_role: int
    reporter_id: int
    target_type: str
    target_id: int
    reason: ReportReason
    description: str | None = None
    status: ReportStatus
    resolution: str | None = None
    resolved_at: datetime.datetime | None = None
    created_at: datetime.datetime


class ReportResolve(BaseModel):
    status: ReportStatus  # RESOLVED | DISMISSED
    resolution: str | None = Field(default=None, max_length=2000)
    # Şikayeti "çözüldü" işaretlemek tek başına içeriğe dokunmaz; hakaret içeren
    # bir yorum kuyruk kapansa da yayında kalırdı. Bu bayrak, çözümle birlikte
    # hedef içeriği yayından kaldırır (yalnız yorum türlerinde geçerlidir).
    hide_target: bool = False

    @field_validator("status")
    @classmethod
    def _terminal_only(cls, v: ReportStatus) -> ReportStatus:
        if v not in (ReportStatus.RESOLVED, ReportStatus.DISMISSED):
            raise ValueError("status RESOLVED veya DISMISSED olmalı")
        return v


class ReportCountOut(BaseModel):
    open: int
