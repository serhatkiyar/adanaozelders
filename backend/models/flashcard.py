from __future__ import annotations

import datetime

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin


class FlashcardDeck(Base, TimestampMixin, SoftDeleteMixin):
    """Kelime kartı destesi. Birleşik kullanıcı tablosu olmadığından sahiplik
    (user_id, role_id) çiftiyle belirlenir (bkz. notifications deseni)."""

    __tablename__ = "flashcard_decks"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    role_id: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    cards: Mapped[list["Flashcard"]] = relationship(
        back_populates="deck", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_flashcard_decks_owner", "user_id", "role_id"),
    )


class Flashcard(Base, TimestampMixin, SoftDeleteMixin):
    """Tek kart (ön/arka) + SM-2 (Anki) aralıklı tekrar durumu."""

    __tablename__ = "flashcards"

    id: Mapped[int] = mapped_column(primary_key=True)
    deck_id: Mapped[int] = mapped_column(
        ForeignKey("flashcard_decks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    front: Mapped[str] = mapped_column(Text, nullable=False)
    back: Mapped[str] = mapped_column(Text, nullable=False)

    # SM-2 durumu.
    ease_factor: Mapped[float] = mapped_column(
        Float, nullable=False, server_default=text("2.5")
    )
    # Bir sonraki aralık DAKİKA cinsinden (Anki öğrenme adımları: 1dk/10dk/1sa…).
    interval_minutes: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    repetitions: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    # Bir sonraki tekrar zamanı; yeni kartlar oluşturulduğunda hemen "due".
    due_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_reviewed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    deck: Mapped["FlashcardDeck"] = relationship(back_populates="cards")

    __table_args__ = (
        Index("ix_flashcards_deck_due", "deck_id", "due_at"),
    )
