from __future__ import annotations

import datetime
import enum

from sqlalchemy import DateTime, Index, Integer, String, Text, text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import TimestampMixin


class ReportStatus(str, enum.Enum):
    OPEN = "OPEN"
    RESOLVED = "RESOLVED"
    DISMISSED = "DISMISSED"


class ReportReason(str, enum.Enum):
    SPAM = "SPAM"
    HARASSMENT = "HARASSMENT"          # taciz / hakaret
    INAPPROPRIATE = "INAPPROPRIATE"    # uygunsuz içerik
    CONTACT_INFO = "CONTACT_INFO"      # platform dışına çıkarma (anti-disintermediation)
    SCAM = "SCAM"                      # dolandırıcılık
    OTHER = "OTHER"


# Şikayet edilebilir hedef türleri (serbest string ama whitelist ile sınırlı).
REPORT_TARGET_TYPES: frozenset[str] = frozenset(
    {"TUTOR", "CLIENT", "REVIEW", "MESSAGE", "BOOKING_COMMENT"}
)


class Report(Base, TimestampMixin):
    """Kullanıcı şikayeti (trust & safety). Admin moderasyon kuyruğunda işlenir.

    Hedef generic'tir (``target_type`` + ``target_id``) — kullanıcı, yorum, mesaj
    veya ders yorumu şikayet edilebilir. Çözüm admin tarafından yapılır
    (``status`` + ``resolution`` + ``resolved_by/at``) ve audit_logs'a yazılır.
    """

    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    reporter_role: Mapped[int] = mapped_column(Integer, nullable=False)
    reporter_id: Mapped[int] = mapped_column(Integer, nullable=False)

    target_type: Mapped[str] = mapped_column(String(30), nullable=False)
    target_id: Mapped[int] = mapped_column(Integer, nullable=False)

    reason: Mapped[ReportReason] = mapped_column(
        SAEnum(ReportReason, name="report_reason"), nullable=False
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[ReportStatus] = mapped_column(
        SAEnum(ReportStatus, name="report_status"),
        nullable=False,
        server_default=text("'OPEN'"),
    )
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    resolved_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("ix_reports_status", "status"),
        Index("ix_reports_target", "target_type", "target_id"),
        Index("ix_reports_reporter", "reporter_role", "reporter_id"),
    )
