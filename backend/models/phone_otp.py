from __future__ import annotations

import datetime

from sqlalchemy import DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import TimestampMixin


class PhoneOtp(Base, TimestampMixin):
    """Telefon doğrulama için tek kullanımlık SMS OTP kodu.

    GÜVENLİK: Ham kod DB'de saklanmaz; yalnız SHA-256 özeti (``code_hash``) tutulur.
    Süre sınırlı (``expires_at``), tek kullanımlık (``used_at``) ve deneme limitli
    (``attempts``). Hedef kullanıcı (user_id, role_id) + doğrulanan numara (``phone``)
    ile bağlanır. E-posta token'larından ayrı tablo: kısa sayısal kodda global
    benzersizlik olamaz (çakışırdı) ve deneme sayacı gerekir.
    """

    __tablename__ = "phone_otps"

    id: Mapped[int] = mapped_column(primary_key=True)
    role_id: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    used_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    __table_args__ = (
        Index("ix_phone_otps_target", "role_id", "user_id"),
    )
