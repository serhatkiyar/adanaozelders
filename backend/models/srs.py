"""İP-16 — Aralıklı tekrar (FSRS-5) şeması.

Mevcut SM-2 tabanlı `flashcards` paketi KAPSAM DIŞIDIR (sözleşme §0); bu
modeller tamamen bağımsız `srs_` önekli tablolardır.

Tasarım notları (sözleşme §3):

* Sahiplik her yerde ``(owner_user_id, owner_role_id)`` çiftidir — birleşik
  kullanıcı tablosu yok (notifications deseni).
* ``srs_progress`` satırı TEMBEL oluşturulur (ilk cevap/suspend/bury'de);
  satırı olmayan kart NEW sayılır. Bu yüzden kart içeriği (notes/cards) ile
  kişisel ilerleme (progress/review_logs) ayrı tablolardadır — K-6 gizlilik
  sınırının şema karşılığı.
* Enum'lar String + CHECK ile tutulur (PG native enum DEĞİL): downgrade
  temiz kalır, `ALTER TYPE ... ADD VALUE` tuzağı doğmaz.
* ``srs_review_logs.prev_*`` anlık görüntüsü üç işe yarar: undo (S-4),
  istatistik (review limiti `prev_state ∈ {REVIEW, RELEARNING}` üzerinden
  sayılır — L sözleşmesi) ve idempotency claim'inin denetimi.
"""
from __future__ import annotations

import datetime
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin

# String+CHECK enum değerleri (tek kaynak; servis katmanı da bunları kullanır).
DECK_VISIBILITIES = ("PRIVATE", "PLATFORM")
NOTE_TYPES = ("BASIC", "BASIC_REVERSED", "CLOZE", "TYPE_IN")
PROGRESS_STATES = ("NEW", "LEARNING", "REVIEW", "RELEARNING")


class SrsDeck(Base, TimestampMixin, SoftDeleteMixin):
    """Deste (hiyerarşik). ``parent_id`` zinciri limit kalıtımı ve alt-ağaç
    sayımı içindir; alt deste sahibiyle aynı kişiye aittir (CASCADE yok,
    soft-delete servis katmanında alt-ağaca yayılır)."""

    __tablename__ = "srs_decks"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    owner_role_id: Mapped[int] = mapped_column(Integer, nullable=False)
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("srs_decks.id"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    visibility: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default="PRIVATE"
    )
    # NULL = üstten kalıt; kökte de NULL ise params varsayılanı (20/200).
    new_per_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reviews_per_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Yalnız bilgi (K-7): kaynak silinse de kopya yaşar → ON DELETE SET NULL.
    copied_from_id: Mapped[int | None] = mapped_column(
        ForeignKey("srs_decks.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        CheckConstraint(
            "visibility IN ('PRIVATE', 'PLATFORM')",
            name="ck_srs_decks_visibility",
        ),
        Index("ix_srs_decks_owner", "owner_user_id", "owner_role_id"),
    )


class SrsNote(Base, TimestampMixin, SoftDeleteMixin):
    """Not — kartların kaynağı. Metin NOTTA yaşar; kartlar (note, ordinal)
    kimliğiyle şablon örnekleridir (Anki modeli, sözleşme §6)."""

    __tablename__ = "srs_notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    deck_id: Mapped[int] = mapped_column(ForeignKey("srs_decks.id"), nullable=False)
    note_type: Mapped[str] = mapped_column(String(20), nullable=False)
    front: Mapped[str] = mapped_column(Text, nullable=False)
    back: Mapped[str] = mapped_column(Text, nullable=False)

    cards: Mapped[list["SrsCard"]] = relationship(back_populates="note")

    __table_args__ = (
        CheckConstraint(
            "note_type IN ('BASIC', 'BASIC_REVERSED', 'CLOZE', 'TYPE_IN')",
            name="ck_srs_notes_note_type",
        ),
        Index("ix_srs_notes_deck", "deck_id"),
    )


class SrsCard(Base, TimestampMixin, SoftDeleteMixin):
    """Kart = (not, şablon sırası). BASIC/TYPE_IN: 0; REVERSED: 0 ön→arka,
    1 arka→ön; CLOZE: cN−1. ``deck_id`` denormdur (kart tek başına başka
    desteye taşınabilir — tarayıcı toplu işlemi)."""

    __tablename__ = "srs_cards"

    id: Mapped[int] = mapped_column(primary_key=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("srs_notes.id"), nullable=False)
    deck_id: Mapped[int] = mapped_column(ForeignKey("srs_decks.id"), nullable=False)
    template_ord: Mapped[int] = mapped_column(Integer, nullable=False)

    note: Mapped["SrsNote"] = relationship(back_populates="cards")

    __table_args__ = (
        Index("uq_srs_cards_note_ord", "note_id", "template_ord", unique=True),
        Index("ix_srs_cards_deck", "deck_id"),
    )


class SrsProgress(Base, TimestampMixin, SoftDeleteMixin):
    """Kişi-başı kart ilerlemesi (K-6 gizlilik sınırının öznesi).

    Satır tembel doğar; UNIQUE(card, user, role) idempotent upsert'in
    (`ON CONFLICT DO NOTHING`) ve eşzamanlılık serileşmesinin çapasıdır.
    """

    __tablename__ = "srs_progress"

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("srs_cards.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    role_id: Mapped[int] = mapped_column(Integer, nullable=False)
    state: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="NEW"
    )
    step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stability: Mapped[float | None] = mapped_column(Float, nullable=True)
    difficulty: Mapped[float | None] = mapped_column(Float, nullable=True)
    due_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_review_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reps: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    lapses: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    suspended_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    buried_until: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    is_leech: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    __table_args__ = (
        CheckConstraint(
            "state IN ('NEW', 'LEARNING', 'REVIEW', 'RELEARNING')",
            name="ck_srs_progress_state",
        ),
        Index("uq_srs_progress_card_user", "card_id", "user_id", "role_id", unique=True),
        Index("ix_srs_progress_user_due", "user_id", "role_id", "due_at"),
    )


class SrsReviewLog(Base, TimestampMixin, SoftDeleteMixin):
    """Cevap günlüğü: idempotency claim'i (kısmi unique client_token),
    undo (prev_* anlık görüntüsü) ve günlük limit/istatistik sayımları."""

    __tablename__ = "srs_review_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    progress_id: Mapped[int] = mapped_column(
        ForeignKey("srs_progress.id"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    role_id: Mapped[int] = mapped_column(Integer, nullable=False)
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    reviewed_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # Çalışma günü (Europe/Istanbul − 4 saat, sözleşme §4.3) — limit sayaçları
    # bunun üzerinden döner; UTC tarihi DEĞİLDİR (G-1/G-3).
    study_day: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    client_token: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    introduced_new: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    undone_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # prev_* — cevabın HEMEN ÖNCESİ (undo geri yükleme kaynağı, S-4).
    prev_state: Mapped[str | None] = mapped_column(String(20), nullable=True)
    prev_step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prev_stability: Mapped[float | None] = mapped_column(Float, nullable=True)
    prev_difficulty: Mapped[float | None] = mapped_column(Float, nullable=True)
    prev_due_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    prev_last_review_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    prev_reps: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    prev_lapses: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    prev_is_leech: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    prev_suspended_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        CheckConstraint("rating >= 1 AND rating <= 4", name="ck_srs_review_logs_rating"),
        Index("ix_srs_review_logs_user_day", "user_id", "role_id", "study_day"),
        Index("ix_srs_review_logs_progress", "progress_id"),
        # İdempotency claim çapası (S-1/S-2): token'sız (eski istemci) satırlar
        # kısıt dışı kalsın diye KISMİ unique.
        Index(
            "uq_srs_review_logs_client_token",
            "user_id",
            "role_id",
            "client_token",
            unique=True,
            postgresql_where=text("client_token IS NOT NULL"),
        ),
    )


class SrsDeckAssignment(Base, TimestampMixin, SoftDeleteMixin):
    """Eğitmen → öğrenci deste ataması. YALNIZ varlık bilgisi taşır; ilerleme
    alanı bilinçli olarak YOKTUR ve eklenmez (K-6, D-6 nöbetçisi)."""

    __tablename__ = "srs_deck_assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    deck_id: Mapped[int] = mapped_column(ForeignKey("srs_decks.id"), nullable=False)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), nullable=False)
    assigned_by_tutor_id: Mapped[int] = mapped_column(
        ForeignKey("tutors.id"), nullable=False
    )

    __table_args__ = (
        Index("uq_srs_deck_assignments_deck_client", "deck_id", "client_id", unique=True),
    )


class SrsTag(Base, TimestampMixin, SoftDeleteMixin):
    """Kullanıcı etiketi; ad benzersizliği lower(name) ile (Mat == mat)."""

    __tablename__ = "srs_tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    owner_role_id: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)

    __table_args__ = (
        Index(
            "uq_srs_tags_owner_lower_name",
            "owner_user_id",
            "owner_role_id",
            func.lower(name),
            unique=True,
        ),
    )


class SrsNoteTag(Base, TimestampMixin, SoftDeleteMixin):
    """Not ↔ etiket bağı (CASCADE: not ya da etiket fiziksel silinirse bağ da)."""

    __tablename__ = "srs_note_tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    note_id: Mapped[int] = mapped_column(
        ForeignKey("srs_notes.id", ondelete="CASCADE"), nullable=False
    )
    tag_id: Mapped[int] = mapped_column(
        ForeignKey("srs_tags.id", ondelete="CASCADE"), nullable=False
    )

    __table_args__ = (
        Index("uq_srs_note_tags_note_tag", "note_id", "tag_id", unique=True),
        Index("ix_srs_note_tags_tag", "tag_id"),
    )
