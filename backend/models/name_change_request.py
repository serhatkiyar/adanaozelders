from __future__ import annotations

import datetime

from sqlalchemy import DateTime, Index, Integer, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base


class NameChangeRequest(Base):
    """Ad-soyad / kullanıcı adı için ikinci ve sonraki değişiklik talebi.

    İlk değişiklik serbest uygulanır (sayaç artar). Sonraki değişiklikler doğrudan
    uygulanmaz; PENDING talep olarak buraya yazılır ve admin onaylayınca uygulanır.
    Kullanıcı tabloları ayrı olduğundan FK yok; ``(user_id, role_id)`` ikilisiyle
    sahibe bağlanır (bildirimler/şikayetlerle aynı desen).
    """

    __tablename__ = "name_change_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    role_id: Mapped[int] = mapped_column(Integer, nullable=False)
    # 'NAME' (ad-soyad) | 'USERNAME' (kullanıcı adı)
    kind: Mapped[str] = mapped_column(String(12), nullable=False)

    # Talep edilen yeni değerler (kind'e göre dolu).
    new_first_name: Mapped[str | None] = mapped_column(String(75), nullable=True)
    new_last_name: Mapped[str | None] = mapped_column(String(75), nullable=True)
    new_username: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Kullanıcının değişiklik gerekçesi (zorunlu).
    reason: Mapped[str] = mapped_column(Text, nullable=False)

    # PENDING | APPROVED | REJECTED
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'PENDING'")
    )
    review_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    reviewed_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reviewed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("ix_name_change_requests_status", "status"),
        Index("ix_name_change_requests_user", "user_id", "role_id"),
    )
