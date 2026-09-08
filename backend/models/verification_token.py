from __future__ import annotations

import datetime
import enum

from sqlalchemy import DateTime, Index, Integer, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import TimestampMixin


class TokenPurpose(str, enum.Enum):
    EMAIL_VERIFY = "EMAIL_VERIFY"
    PASSWORD_RESET = "PASSWORD_RESET"
    #: Parolasız (Google ile açılmış) hesabın silme onayı. Parolalı hesapta
    #: silme parola ile onaylanır; parolası olmayan hesabın o yolu yoktur ve
    #: KVKK silme hakkı kapalı bırakılamaz — onay e-postaya gönderilen tek
    #: kullanımlık bir bağlantıyla verilir.
    ACCOUNT_DELETE = "ACCOUNT_DELETE"


class VerificationToken(Base, TimestampMixin):
    """E-posta doğrulama ve şifre sıfırlama için tek kullanımlık token.

    GÜVENLİK: Ham token DB'de saklanmaz; yalnızca SHA-256 özeti (``token_hash``)
    tutulur — DB sızsa bile token kullanılamaz. Ham token e-posta linkinde gider;
    onayda gelen token hash'lenip burada aranır. Tek kullanımlık (``used_at``) ve
    süre sınırlı (``expires_at``). Hedef kullanıcı (user_id, role_id) ile bağlanır.
    """

    __tablename__ = "verification_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    purpose: Mapped[TokenPurpose] = mapped_column(
        SAEnum(TokenPurpose, name="token_purpose"), nullable=False
    )
    role_id: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    used_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("uq_verification_tokens_hash", "token_hash", unique=True),
        Index(
            "ix_verification_tokens_target",
            "purpose",
            "role_id",
            "user_id",
        ),
    )
