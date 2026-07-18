from __future__ import annotations

import datetime

from sqlalchemy import DateTime, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base


class AuditLog(Base):
    """Admin kritik aksiyonlarının değiştirilemez kaydı (hesap verebilirlik).

    Yapılandırılmış alanlar (before/after/meta) audit_service.record üzerinden
    HER ZAMAN redaction'dan geçer — şifre/token/TCKN/secret bu tabloya girmez.
    Update/delete endpoint'i YOKTUR ve yazılmamalıdır (append-only sözleşme)."""

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
    # ── Yapılandırılmış denetim (devir belgesi Öncelik 1) ──
    # Aksiyonun gerekçesi (hassas işlemlerde zorunlu tutulur — router seviyesi).
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Değişiklik öncesi/sonrası alan özetleri (redaction'lı JSONB).
    before_values: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    after_values: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Ek bağlam (ör. toplu işlem sayacı) — "metadata" adı SQLAlchemy'de rezerve,
    # kolon adı metadata kalır, attribute meta.
    meta: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    # İstek bağlamı: kaynak IP + log korelasyonu için request-id.
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("ix_audit_logs_created", "created_at"),
        Index("ix_audit_logs_target", "target_type", "target_id"),
    )
