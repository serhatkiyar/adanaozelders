from __future__ import annotations

import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from core.storage_types import PublicAsset
from models.messaging import BlockReason


class MessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    # Bu mesaj hangi mesaja yanıt (aynı sohbet içinde). Opsiyonel.
    reply_to_id: int | None = None
    # Alıcının taraf türü: CLIENT | TUTOR | LIBRARY. Verilmezse sunucu gönderene
    # göre çıkarır (CLIENT→TUTOR, TUTOR→CLIENT); kütüphaneyle yazışmada zorunlu.
    counterparty_role: str | None = None


class ReplyPreview(BaseModel):
    """Yanıtlanan mesajın kısa önizlemesi (balonun üstünde gösterilir)."""

    id: int
    sender_role: str
    body: str


class ReactionOut(BaseModel):
    emoji: str
    count: int
    # İstek sahibi bu emojiyle tepki vermiş mi?
    reacted: bool = False


class ReactionRequest(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    conversation_id: int
    sender_role: str
    sender_id: int
    body: str
    created_at: datetime.datetime
    reply_to_id: int | None = None
    reply_preview: ReplyPreview | None = None
    reactions: list[ReactionOut] = []
    msg_type: str = "text"
    meta_data: dict | None = None
    # Gönderim yanıtında: gövdede iletişim bilgisi/dış bağlantı gizlendi mi?
    contact_masked: bool = False


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    client_id: int
    tutor_id: int
    created_at: datetime.datetime
    # Servis katmanında doldurulan türetilmiş alanlar (kolon değil).
    counterparty_id: int | None = None
    counterparty_name: str | None = None
    counterparty_avatar_url: PublicAsset | None = None
    # Karşı tarafın türü: CLIENT | TUTOR | LIBRARY (frontend doğru hedeflesin).
    counterparty_role: str | None = None
    # Karşı taraf eğitmense kök ilan adresi (Modül 6); yoksa None.
    counterparty_url_slug: str | None = None
    last_message: str | None = None
    last_message_at: datetime.datetime | None = None
    unread: int = 0
    # Karşı tarafın bu sohbeti en son okuduğu an ("Görüldü" göstergesi için).
    counterparty_last_read_at: datetime.datetime | None = None
    # İstek sahibi bu sohbeti arşivlemiş mi?
    archived: bool = False
    # CLIENT↔TUTOR sohbetinde aşama (LESSON | INQUIRY); kütüphane sohbetinde None.
    stage: Literal["LESSON", "INQUIRY"] | None = None
    # Eğitmen görünümünde "ben engelledim", öğrenci görünümünde "beni engelledi".
    blocked: bool = False


class MessageSearchHit(BaseModel):
    """Mesaj aramasında gövdesi eşleşen tek bir mesaj (her eşleşme ayrı satır).
    Tıklanınca ilgili sohbette bu mesaja atlanır."""

    message_id: int
    conversation_id: int
    counterparty_id: int | None = None
    counterparty_name: str | None = None
    counterparty_avatar_url: PublicAsset | None = None
    counterparty_role: str | None = None
    sender_role: str
    body: str
    created_at: datetime.datetime


class MessageSearchResults(BaseModel):
    """Arama sonucu iki bölüm: isim eşleşmeleri (chats) + gövde eşleşmeleri (messages)."""

    chats: list[ConversationOut] = []
    messages: list[MessageSearchHit] = []


class MessagesUnreadCounts(BaseModel):
    """Okunmamış mesaj sayısı, gelen kutusu ve arşiv olarak ayrı."""

    inbox: int = 0
    archived: int = 0


class MessagingEligibilityOut(BaseModel):
    """Öğrencinin bir eğitmene şu an yazıp yazamayacağı ve kalan hakları."""

    can_send: bool
    stage: Literal["LESSON", "INQUIRY"]
    blocked: bool = False
    reason_code: (
        Literal["MESSAGE_BLOCKED", "INQUIRY_DAILY_LIMIT", "INQUIRY_AWAITING_REPLY"]
        | None
    ) = None
    reason_message: str | None = None
    conversation_id: int | None = None
    # Yalnız INQUIRY'de ve eğitmen hiç yazmamışken sayı; aksi halde None.
    remaining_before_reply: int | None = None
    # Yalnız INQUIRY'de ve sohbette henüz öğrenci mesajı yokken sayı.
    new_conversations_left_today: int | None = None


class MessageTemplateCreate(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    body: str = Field(min_length=1, max_length=4000)


class MessageTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    body: str
    created_at: datetime.datetime


class BlockCreate(BaseModel):
    client_id: int = Field(gt=0)
    reason: BlockReason
    note: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _other_requires_note(self) -> "BlockCreate":
        if self.note is not None:
            self.note = self.note.strip() or None
        if self.reason == BlockReason.OTHER and len(self.note or "") < 3:
            raise ValueError("Diğer gerekçesinde en az 3 karakterlik not zorunlu")
        return self


class BlockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    client_id: int
    reason: BlockReason
    note: str | None = None
    created_at: datetime.datetime
