from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, Field


class MessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    conversation_id: int
    sender_role: str
    sender_id: int
    body: str
    created_at: datetime.datetime


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
    last_message: str | None = None
    last_message_at: datetime.datetime | None = None
    unread: int = 0
