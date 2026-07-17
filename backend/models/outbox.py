"""Transactional outbox — commit-sonrası dış yan etkilerin güvenilir taşıyıcısı.

SMS/e-posta gibi GERİ ALINAMAZ yan etkiler, tetikleyen iş akışıyla AYNI
transaction'da buraya olay olarak yazılır (atomiklik: durum değişikliği ile olay
ya birlikte kalıcı olur ya hiçbiri). Arka plandaki worker (main.py `_outbox_loop`
→ core/outbox.dispatch_pending) bekleyenleri at-least-once gönderir; başarısız
gönderim üstel geri çekilmeyle (backoff) yeniden denenir, deneme tavanında FAILED
(dead-letter — satır silinmez, incelenebilir) olur.

Kapıda beklenen teslim OTP'si bilinçli olarak outbox'a GİRMEZ — kurye saniyeler
içinde sonuç bekler; o akış senkron kalır ve gerçek gönderim sonucunu döner.
"""
from __future__ import annotations

import datetime
import enum

from sqlalchemy import DateTime, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import TimestampMixin


class OutboxStatus(str, enum.Enum):
    PENDING = "PENDING"
    SENT = "SENT"
    FAILED = "FAILED"  # deneme tavanı aşıldı — dead-letter


class OutboxEvent(Base, TimestampMixin):
    __tablename__ = "outbox_events"
    __table_args__ = (
        # Worker'ın tek sorgusu: gönderilmeyi bekleyen + zamanı gelmiş olaylar.
        Index(
            "ix_outbox_pending_due",
            "next_attempt_at",
            postgresql_where=text("status = 'PENDING'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Handler anahtarı: "sms:tracking_link" | "sms:approach" | "sms:failed" |
    # "sms:postponed" | "email:order_status" (core/outbox.py _HANDLERS).
    kind: Mapped[str] = mapped_column(String(60), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'PENDING'")
    )
    attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    next_attempt_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
