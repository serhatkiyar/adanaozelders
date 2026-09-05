from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import (
    AuthVersionMixin,
    EmailVerificationMixin,
    LastSeenMixin,
    NameMixin,
    SoftDeleteMixin,
    TimestampMixin,
)


class Admin(
    Base,
    NameMixin,
    TimestampMixin,
    SoftDeleteMixin,
    LastSeenMixin,
    EmailVerificationMixin,
    AuthVersionMixin,
):
    __tablename__ = "admins"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    role_id: Mapped[int] = mapped_column(
        ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False
    )
    about: Mapped[str | None] = mapped_column(Text, nullable=True)

    role: Mapped["Role"] = relationship()

    __table_args__ = (
        Index(
            "uq_admins_email_active",
            "email",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )
