"""Gerçek-zamanlı (Centrifugo) uçları.

Mevcut ``/ws`` ucunun YERİNE GEÇMEZ — ona hiç dokunulmadı. Buradaki yüzey
yalnız yeni, replika-güvenli yetenek içindir (ilk kullanıcı: "yazıyor…").
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUser, get_current_active_user, user_rate_limit
from core import centrifugo
from core.config import settings
from core.database import get_db
from schemas.realtime import RealtimeTokenOut, TypingIn
from services import messaging_service

router = APIRouter(prefix="/realtime", tags=["realtime"])


def _acik_mi() -> None:
    """Özellik kapalıyken 503. Sessiz başarı DÖNÜLMEZ: istemci bağlanmayı
    bekleyip sonsuza dek boş kanal dinlerdi."""
    if not settings.CENTRIFUGO_ENABLED:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Gerçek-zamanlı servis kapalı"
        )


@router.post(
    "/token",
    response_model=RealtimeTokenOut,
    dependencies=[
        Depends(user_rate_limit(key="centrifugo_token", limit=30, window_seconds=60))
    ],
)
async def connection_token(
    user: CurrentUser = Depends(get_current_active_user),
) -> RealtimeTokenOut:
    """Kısa ömürlü Centrifugo bağlantı token'ı.

    Token DB'ye yazılmaz ve iptal edilemez; ömrü bu yüzden kısadır
    (``CENTRIFUGO_TOKEN_TTL_SECONDS``). Yetki kaybı en geç bir sonraki
    yenilemede etkisini gösterir — yenileme isteği buradan geçer ve
    ``get_current_active_user`` denylist/auth_version/is_active denetimlerini
    yeniden uygular.
    """
    _acik_mi()
    return RealtimeTokenOut(
        token=centrifugo.make_connection_token(
            user_id=user.id, role_id=user.role_id
        ),
        channel=centrifugo.personal_channel(
            user_id=user.id, role_id=user.role_id
        ),
        ttl=settings.CENTRIFUGO_TOKEN_TTL_SECONDS,
    )


@router.post(
    "/typing",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[
        Depends(user_rate_limit(key="typing", limit=60, window_seconds=60))
    ],
)
async def typing(
    payload: TypingIn,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Karşı tarafa "yazıyor…" ipucu. Hiçbir şey KAYDETMEZ.

    Sohbet üyeliği ``messaging_service``'te doğrulanır (404/403). Yayının
    kendisi best-effort'tur: Centrifugo düşse de uç 204 döner, çünkü
    kullanıcının gerçek işi (mesaj yazmak) bu ipucuna bağlı değildir.
    """
    _acik_mi()
    hedefler = await messaging_service.typing_targets(
        db, user, payload.conversation_id
    )
    await centrifugo.broadcast(
        [centrifugo.personal_channel(user_id=uid, role_id=rid) for rid, uid in hedefler],
        {"type": "TYPING", "conversation_id": payload.conversation_id},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
