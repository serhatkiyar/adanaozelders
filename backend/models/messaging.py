from __future__ import annotations

import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import TimestampMixin


class Conversation(Base, TimestampMixin):
    """İki taraf arasında sohbet. Taraflar: CLIENT, TUTOR, LIBRARY (kütüphane).
    Tam olarak iki yuva (client_id/tutor_id/library_id) doludur:
    CLIENT↔TUTOR, CLIENT↔LIBRARY veya TUTOR↔LIBRARY. Kütüphane tarafına operatör
    (role_id=4) hesapları erişir; party kimliği ``library_id``'dir."""

    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int | None] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=True
    )
    tutor_id: Mapped[int | None] = mapped_column(
        ForeignKey("tutors.id", ondelete="CASCADE"), nullable=True
    )
    library_id: Mapped[int | None] = mapped_column(
        ForeignKey("libraries.id", ondelete="CASCADE"), nullable=True
    )
    # Okunmamış sayacı için taraf başına son okuma zamanı.
    client_last_read_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    tutor_last_read_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    library_last_read_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Arşiv — taraf başına (Telegram gibi); dolu ise o taraf için ana listede gizli.
    client_archived_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    tutor_archived_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    library_archived_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )

    __table_args__ = (
        # Her taraf çifti için ayrı kısmî benzersiz index (tekrar sohbet önlenir).
        Index(
            "uq_conv_client_tutor",
            "client_id",
            "tutor_id",
            unique=True,
            postgresql_where=text("client_id IS NOT NULL AND tutor_id IS NOT NULL"),
        ),
        Index(
            "uq_conv_client_library",
            "client_id",
            "library_id",
            unique=True,
            postgresql_where=text("client_id IS NOT NULL AND library_id IS NOT NULL"),
        ),
        Index(
            "uq_conv_tutor_library",
            "tutor_id",
            "library_id",
            unique=True,
            postgresql_where=text("tutor_id IS NOT NULL AND library_id IS NOT NULL"),
        ),
        Index("ix_conversations_client", "client_id"),
        Index("ix_conversations_tutor", "tutor_id"),
        Index("ix_conversations_library", "library_id"),
    )


class Message(Base, TimestampMixin):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sender_role: Mapped[str] = mapped_column(String(10), nullable=False)
    sender_id: Mapped[int] = mapped_column(nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # Yanıt/alıntı: bu mesaj hangi mesaja cevap (aynı sohbet içinde). Silinirse NULL.
    reply_to_id: Mapped[int | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Mesaj türü: "text" (varsayılan sohbet), "booking_card" (gömülü ders kartı).
    msg_type: Mapped[str] = mapped_column(String(30), nullable=False, server_default="text")
    # Zengin mesajlar (booking_card vb.) için JSON yük. Metin mesajlarında NULL.
    meta_data: Mapped[dict | None] = mapped_column(sa.JSON, nullable=True)

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")
    reply_to: Mapped["Message | None"] = relationship(remote_side=[id])
    reactions: Mapped[list["MessageReaction"]] = relationship(
        back_populates="message", cascade="all, delete-orphan"
    )


class MessageReaction(Base, TimestampMixin):
    """Bir mesaja emoji tepkisi. Kullanıcı (role_id,user_id) bir emojiyi bir kez
    bırakabilir (toggle); farklı emojiler ayrı satır."""

    __tablename__ = "message_reactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    message_id: Mapped[int] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), nullable=False
    )
    role_id: Mapped[int] = mapped_column(nullable=False)
    user_id: Mapped[int] = mapped_column(nullable=False)
    emoji: Mapped[str] = mapped_column(String(16), nullable=False)

    message: Mapped["Message"] = relationship(back_populates="reactions")

    __table_args__ = (
        UniqueConstraint(
            "message_id", "role_id", "user_id", "emoji", name="uq_reaction"
        ),
        Index("ix_message_reactions_message", "message_id"),
    )
