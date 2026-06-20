from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, Field


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


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    client_id: int
    tutor_id: int
    created_at: datetime.datetime
    # Servis katmanında doldurulan türetilmiş alanlar (kolon değil).
    counterparty_id: int | None = None
    counterparty_name: str | None = None
    counterparty_avatar_url: str | None = None
    # Karşı tarafın türü: CLIENT | TUTOR | LIBRARY (frontend doğru hedeflesin).
    counterparty_role: str | None = None
    last_message: str | None = None
    last_message_at: datetime.datetime | None = None
    unread: int = 0
    # Karşı tarafın bu sohbeti en son okuduğu an ("Görüldü" göstergesi için).
    counterparty_last_read_at: datetime.datetime | None = None
    # İstek sahibi bu sohbeti arşivlemiş mi?
    archived: bool = False


class MessageSearchHit(BaseModel):
    """Mesaj aramasında gövdesi eşleşen tek bir mesaj (her eşleşme ayrı satır).
    Tıklanınca ilgili sohbette bu mesaja atlanır."""

    message_id: int
    conversation_id: int
    counterparty_id: int | None = None
    counterparty_name: str | None = None
    counterparty_avatar_url: str | None = None
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
