from __future__ import annotations

from sqlalchemy import ForeignKey, Index, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin


class DemandResponse(Base, TimestampMixin, SoftDeleteMixin):
    """Bir eğitmenin açık talebe (Demand) verdiği yanıt — öğrenciyle sohbeti açan 'lead'.

    Eğitmen yanıt verdiğinde öğrenci↔eğitmen sohbeti açılır (ilk mesaj eğitmenden);
    bu kayıt aynı zamanda **rezervasyon olmadan** mesajlaşma iznini sağlar
    (``messaging_service._can_message`` bunu da kabul eder). Talep + eğitmen başına
    tek aktif kayıt (eğitmen aynı talebi tekrar "yanıtlayamaz"; sohbetten devam eder).
    """

    __tablename__ = "demand_responses"

    id: Mapped[int] = mapped_column(primary_key=True)
    demand_id: Mapped[int] = mapped_column(
        ForeignKey("demands.id", ondelete="CASCADE"), nullable=False
    )
    tutor_id: Mapped[int] = mapped_column(
        ForeignKey("tutors.id", ondelete="CASCADE"), nullable=False
    )

    demand: Mapped["Demand"] = relationship()

    __table_args__ = (
        Index(
            "uq_demand_responses_active",
            "demand_id",
            "tutor_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_demand_responses_tutor", "tutor_id"),
    )
