from __future__ import annotations

import datetime

from sqlalchemy import DateTime, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base


class AuditLog(Base):
    """Admin kritik aksiyonlarının değiştirilemez kaydı (hesap verebilirlik)."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Aksiyonu yapan admin.
    actor_id: Mapped[int] = mapped_column(Integer, nullable=False)
    actor_role: Mapped[int] = mapped_column(Integer, nullable=False)
    # ör. "tutor.approve", "booking.cancel", "booking.dispute"
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    # ör. "tutor", "booking"
    target_type: Mapped[str] = mapped_column(String(30), nullable=False)
    target_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Serbest açıklama (neden, eski/yeni değer vb.).
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("ix_audit_logs_created", "created_at"),
        Index("ix_audit_logs_target", "target_type", "target_id"),
    )
