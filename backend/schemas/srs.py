"""İP-16 — Aralıklı tekrar (FSRS-5) HTTP şemaları.

Sözleşme: `docs/ip16-flashcard-sozlesme.md` §8 (uç sözleşmesi) ve §7.2 (K-6).

İki tasarım kararı burada yaşar:

* **Doğrulama şemadadır.** Kart tarayıcısının `state` filtresi, sayfalama
  sınırları, cevap `rating`'i ve toplu işlem adı `Literal`/`Field` ile
  kapatılır — geçersiz değer servise HİÇ ulaşmadan 422 olur (B-6).
* **K-6 gizlilik sınırı yanıt ŞEKLİNDE de vardır.** Hiçbir çıktı şeması
  başkasının ilerlemesini taşıyacak bir alan (client_id'li progress, reps,
  stability…) TANIMLAMAZ; `AssignmentOut` bilinçli olarak yalnız atamanın
  VARLIĞINI döndürür (D-6 nöbetçisi bu gövdeleri tarar).
"""
from __future__ import annotations

import datetime
import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

NoteType = Literal["BASIC", "BASIC_REVERSED", "CLOZE", "TYPE_IN"]
ProgressState = Literal["NEW", "LEARNING", "REVIEW", "RELEARNING"]
BulkAction = Literal[
    "suspend",
    "unsuspend",
    "bury",
    "unbury",
    "move_deck",
    "add_tag",
    "remove_tag",
]
Rating = Literal[1, 2, 3, 4]

MAX_PAGE_SIZE = 200


# ── Desteler ────────────────────────────────────────────────────────────────


class DeckCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    parent_id: int | None = None
    new_per_day: int | None = Field(default=None, ge=0, le=9999)
    reviews_per_day: int | None = Field(default=None, ge=0, le=99999)


class DeckUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    parent_id: int | None = None
    new_per_day: int | None = Field(default=None, ge=0, le=9999)
    reviews_per_day: int | None = Field(default=None, ge=0, le=99999)


class PlatformDeckCreate(BaseModel):
    """Admin platform destesi — `visibility` istemciden ALINMAZ (sunucu koyar)."""

    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    parent_id: int | None = None
    new_per_day: int | None = Field(default=None, ge=0, le=9999)
    reviews_per_day: int | None = Field(default=None, ge=0, le=99999)


class DeckOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None = None
    parent_id: int | None = None
    visibility: str
    new_per_day: int | None = None
    reviews_per_day: int | None = None
    copied_from_id: int | None = None
    created_at: datetime.datetime


class DeckListOut(BaseModel):
    """Kendi ağacı + (CLIENT) atananlar. Platform galerisi ayrı uçtadır."""

    own: list[DeckOut]
    assigned: list[DeckOut] = Field(default_factory=list)


class DeckItemsOut(BaseModel):
    items: list[DeckOut]


# ── Atama (K-6: YALNIZ varlık bilgisi) ──────────────────────────────────────


class AssignIn(BaseModel):
    client_id: int


class AssignOut(BaseModel):
    deck_id: int
    client_id: int
    assigned_at: datetime.datetime | None = None


class AssignmentOut(BaseModel):
    """Eğitmenin görebildiği TEK şey. İlerleme alanı eklenmez (D-6)."""

    client_id: int
    client_name: str | None = None
    assigned_at: datetime.datetime | None = None


class AssignmentListOut(BaseModel):
    items: list[AssignmentOut]


# ── Notlar ──────────────────────────────────────────────────────────────────


class NoteCreate(BaseModel):
    note_type: NoteType = "BASIC"
    front: str = Field(min_length=1, max_length=20000)
    back: str = Field(default="", max_length=20000)
    tags: list[str] = Field(default_factory=list, max_length=50)


class NoteUpdate(BaseModel):
    front: str | None = Field(default=None, min_length=1, max_length=20000)
    back: str | None = Field(default=None, max_length=20000)
    tags: list[str] | None = Field(default=None, max_length=50)


class NoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    deck_id: int
    note_type: str
    front: str
    back: str
    created_at: datetime.datetime


# ── Etiketler ───────────────────────────────────────────────────────────────


class TagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class TagListOut(BaseModel):
    items: list[TagOut]


# ── Kart tarayıcı ───────────────────────────────────────────────────────────


class CardOut(BaseModel):
    """`state`/`due_at`/`suspended` İSTEYENİN KENDİ ilerlemesidir (K-6)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    note_id: int
    deck_id: int
    template_ord: int
    note_type: str
    front: str
    back: str
    tags: list[str] = Field(default_factory=list)
    state: ProgressState = "NEW"
    due_at: datetime.datetime | None = None
    suspended: bool = False


class CardListOut(BaseModel):
    items: list[CardOut]
    total: int


class BulkIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=1000)
    action: BulkAction
    target_deck_id: int | None = None
    tag: str | None = Field(default=None, max_length=100)


class BulkOut(BaseModel):
    affected: int


# ── Çalışma oturumu ─────────────────────────────────────────────────────────


class QueueCountsOut(BaseModel):
    new: int = 0
    learning: int = 0
    review: int = 0


class QueueCardOut(BaseModel):
    id: int
    note_id: int
    deck_id: int
    note_type: str
    template_ord: int
    front: str
    back: str
    state: ProgressState = "NEW"
    due_at: datetime.datetime | None = None
    #: Dört rating için sonraki aralık (dakika) — çalışma ekranı önizlemesi.
    previews: dict[str, int] = Field(default_factory=dict)


class QueueOut(BaseModel):
    counts: QueueCountsOut
    card: QueueCardOut | None = None


class AnswerIn(BaseModel):
    card_id: int
    rating: Rating
    #: İdempotency çapası (S-1/S-2) — istemci her cevap için yeni UUID üretir.
    client_token: uuid.UUID | None = None


class AnswerOut(BaseModel):
    card_id: int
    state: ProgressState
    step: int | None = None
    due_at: datetime.datetime | None = None
    introduced_new: bool = False
    counts: QueueCountsOut


class UndoOut(BaseModel):
    card_id: int
    state: ProgressState


# ── İstatistik (K-6: yalnız kendi verisi) ───────────────────────────────────


class StateCountsOut(BaseModel):
    """Durum sayımları — anahtarlar KÜÇÜK harf.

    Sebebi yalnız üslup değil: D-6 nöbetçisi eğitmen yanıtlarında
    ``"LEARNING"`` dizgisini öğrenci ilerlemesinin izi sayar. Sayım anahtarını
    büyük harf bırakmak, sıfır değerli bir sözlükle o nöbeti gürültüye boğardı.
    """

    new: int = 0
    learning: int = 0
    review: int = 0
    relearning: int = 0


class FutureLoadOut(BaseModel):
    day: str
    due: int


class StatsOut(BaseModel):
    review_count: int
    retention_rate: float | None = None
    future_load: list[FutureLoadOut] = Field(default_factory=list)
    counts: StateCountsOut = Field(default_factory=StateCountsOut)

    @model_validator(mode="before")
    @classmethod
    def _lowercase_counts(cls, data: Any) -> Any:
        if isinstance(data, dict):
            counts = data.get("counts")
            if isinstance(counts, dict):
                data = {
                    **data,
                    "counts": {str(k).lower(): v for k, v in counts.items()},
                }
        return data
