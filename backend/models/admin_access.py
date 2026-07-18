from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin


class AdminRole(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "admin_roles"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_system: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    __table_args__ = (
        Index(
            "uq_admin_roles_code_active",
            "code",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class AdminPermission(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "admin_permissions"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    group: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index(
            "uq_admin_permissions_code_active",
            "code",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class AdminRolePermission(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "admin_role_permissions"

    id: Mapped[int] = mapped_column(primary_key=True)
    admin_role_id: Mapped[int] = mapped_column(
        ForeignKey("admin_roles.id", ondelete="CASCADE"), nullable=False
    )
    permission_id: Mapped[int] = mapped_column(
        ForeignKey("admin_permissions.id", ondelete="CASCADE"), nullable=False
    )

    role: Mapped[AdminRole] = relationship()
    permission: Mapped[AdminPermission] = relationship()

    __table_args__ = (
        Index("ix_admin_role_permissions_role", "admin_role_id"),
        Index(
            "uq_admin_role_permissions_active",
            "admin_role_id",
            "permission_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class AdminRoleAssignment(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "admin_role_assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    admin_id: Mapped[int] = mapped_column(
        ForeignKey("admins.id", ondelete="CASCADE"), nullable=False
    )
    admin_role_id: Mapped[int] = mapped_column(
        ForeignKey("admin_roles.id", ondelete="RESTRICT"), nullable=False
    )
    assigned_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="SET NULL"), nullable=True
    )

    role: Mapped[AdminRole] = relationship()

    __table_args__ = (
        Index("ix_admin_role_assignments_role", "admin_role_id"),
        Index(
            "uq_admin_role_assignments_admin_active",
            "admin_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )
