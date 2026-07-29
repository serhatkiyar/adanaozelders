from __future__ import annotations

import datetime

from sqlalchemy import Boolean, DateTime, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import TimestampMixin


class RefreshToken(Base, TimestampMixin):
    """Uzun ömürlü, rotasyonlu refresh token (oturum südürürlüğü).

    GÜVENLİK: Ham token DB'de saklanmaz; yalnız SHA-256 özeti tutulur. Her
    kullanımda rotasyon yapılır (eski revoke edilir, yenisi üretilir) — çalınan bir
    token tekrar kullanılırsa zincir kırılır. ``revoked_at`` (logout/rotasyon) ve
    ``expires_at`` ile geçersiz kılınır. Hedef kullanıcı (role_id, user_id).
    """

    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    role_id: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    revoked_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # "Beni hatırla" tercihi. Token çerezde taşındığı için tercihin sunucuda
    # yaşaması gerekir: rotasyon sırasında gelen çerezin kalıcı mı yoksa
    # oturumluk mu olduğu HTTP'de görünmez, dolayısıyla yalnız isteğe bakarak
    # yeni çerezin ömrü doğru seçilemez. Tercih token zincirinde devredilir.
    persistent: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    __table_args__ = (
        Index("uq_refresh_tokens_hash", "token_hash", unique=True),
        Index("ix_refresh_tokens_user", "role_id", "user_id"),
    )
