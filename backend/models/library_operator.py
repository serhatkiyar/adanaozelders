from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import (
    AuthVersionMixin,
    EmailVerificationMixin,
    LastSeenMixin,
    NameMixin,
    PhoneVerificationMixin,
    SoftDeleteMixin,
    TimestampMixin,
)


class LibraryOperator(
    Base,
    NameMixin,
    TimestampMixin,
    SoftDeleteMixin,
    LastSeenMixin,
    EmailVerificationMixin,
    PhoneVerificationMixin,
    AuthVersionMixin,
):
    """Bir kütüphaneye bağlı operatör (kütüphaneci) giriş hesabı. Admin oluşturur.

    Deneme oturumlarında öğrencinin QR kodunu okutarak katılımı doğrular; bu doğrulama
    escrow'daki ödemeyi kütüphaneye serbest bırakır. Diğer kullanıcı tabloları (admin/
    tutor/client) gibi ayrı bir tablodur ve `role_id=4` (LIBRARY_OPERATOR) taşır.
    """

    __tablename__ = "library_operators"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    role_id: Mapped[int] = mapped_column(
        ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False
    )
    library_id: Mapped[int] = mapped_column(
        ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False, index=True
    )

    library: Mapped["Library"] = relationship()

    __table_args__ = (
        Index(
            "uq_library_operators_email_active",
            "email",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "uq_library_operators_username_active",
            "username",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )
