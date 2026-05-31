"""Transaction commit'inden SONRA WebSocket push'u göndermek için request-scoped outbox.

NEDEN: `get_db` commit'i endpoint döndükten sonra yapıyor. WS push'u servis
içinde (commit'ten önce) gönderilirse, alıcının frontend'i push'u alıp hemen
refetch ettiğinde transaction henüz commit'lenmemiş olur → eski veri döner →
kullanıcı sayfayı yenilemek zorunda kalır. Bu yüzden push'lar burada kuyruğa
alınır ve yalnızca commit BAŞARILI olduktan sonra (get_db'de) gönderilir.
Rollback durumunda hiçbir şey gönderilmez (tutarlılık).
"""
from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from core.ws_manager import manager

logger = logging.getLogger(__name__)

_OUTBOX_KEY = "ws_outbox"


def _box(db: AsyncSession) -> list[tuple[dict, int, int]]:
    info = db.sync_session.info
    return info.setdefault(_OUTBOX_KEY, [])


def enqueue(db: AsyncSession, message: dict, *, user_id: int, role_id: int) -> None:
    """WS mesajını commit sonrası gönderilmek üzere kuyruğa ekler."""
    _box(db).append((message, user_id, role_id))


async def flush(db: AsyncSession) -> None:
    """Kuyruktaki tüm push'ları gönderir. get_db tarafından commit'ten SONRA çağrılır.
    Her gönderim izole try/except ile korunur — biri hata verse de diğerleri gider
    ve istek akışı bozulmaz (fail-open)."""
    pending = db.sync_session.info.pop(_OUTBOX_KEY, None)
    if not pending:
        return
    for message, user_id, role_id in pending:
        try:
            await manager.send_personal_message(message, user_id, role_id)
        except Exception:  # noqa: BLE001 — WS gönderimi best-effort
            logger.warning("WS push gönderilemedi", exc_info=True)
