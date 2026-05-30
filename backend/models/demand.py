from __future__ import annotations

import enum

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Index, Numeric, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin


class DemandStatus(str, enum.Enum):
    OPEN = "OPEN"
    CLOSED = "CLOSED"
    CANCELLED = "CANCELLED"


class Demand(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "demands"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False
    )

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    subject: Mapped[str] = mapped_column(String(150), nullable=False)
    level: Mapped[str | None] = mapped_column(String(100), nullable=True)
    budget_min: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    budget_max: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    status: Mapped[DemandStatus] = mapped_column(
        SAEnum(DemandStatus, name="demand_status"),
        nullable=False,
        server_default=text("'OPEN'"),
    )

    client: Mapped["Client"] = relationship(back_populates="demands")

    __table_args__ = (
        Index("ix_demands_status_created", "status", "created_at"),
        Index("ix_demands_client", "client_id"),
        Index(
            "ix_demands_subject_trgm",
            "subject",
            postgresql_using="gin",
            postgresql_ops={"subject": "gin_trgm_ops"},
        ),
    )
