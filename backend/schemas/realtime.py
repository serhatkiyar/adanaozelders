from __future__ import annotations

from pydantic import BaseModel, Field


class RealtimeTokenOut(BaseModel):
    """Centrifugo bağlantı bilgisi.

    ``channel`` sunucudan gelir, istemcide türetilmez: kanal adı bir
    yetkilendirme sınırıdır ve istemcinin kendi rolünü/kimliğini yazarak
    kurması, başkasının kanalına abone olma denemesine açık kapı bırakırdı.
    """

    token: str
    channel: str
    #: Saniye. İstemci SDK'sı süre dolmadan yeni token ister.
    ttl: int


class TypingIn(BaseModel):
    conversation_id: int = Field(gt=0)
