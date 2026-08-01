import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from core.ws_manager import manager
from core.database import get_db, AsyncSessionLocal
from core.security import decode_access_token
from models.admin import Admin
from models.client import Client
from models.tutor import Tutor
from models.role import RoleType
from services import booking_service

router = APIRouter(tags=["websocket"])

_ROLE_MODELS: dict[str, type] = {
    RoleType.ADMIN.value: Admin,
    RoleType.TUTOR.value: Tutor,
    RoleType.CLIENT.value: Client,
}

@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    try:
        payload = decode_access_token(token)
        subject = payload.get("sub")
        role_name = payload.get("role")
        role_id = payload.get("role_id")
        
        model = _ROLE_MODELS.get(role_name)
        if subject is None or model is None or role_id is None:
            await websocket.close(code=1008)
            return

        user_id = int(subject)
        user = await db.get(model, user_id)
        if user is None or user.deleted_at is not None or not user.is_active:
            await websocket.close(code=1008)
            return
        # Oturum sürümü (İP-3 §6): şifre değişimi WS erişimini de düşürmeli.
        if payload.get("auth_ver") != user.auth_version:
            await websocket.close(code=1008)
            return
            
    except Exception:
        await websocket.close(code=1008)
        return

    await manager.connect(websocket, user_id, role_id)
    try:
        while True:
            raw = await websocket.receive_text()
            await _handle_inbound(raw, user_id, role_id)
    except WebSocketDisconnect:
        manager.disconnect(websocket, user_id, role_id)


async def _handle_inbound(raw: str, user_id: int, role_id: int) -> None:
    """İstemciden gelen mesajları ele alır. Şimdilik yalnız WebRTC sinyalleşmesi
    (RTC_SIGNAL) — uçtan uca dosya aktarımı için SDP offer/answer + ICE adaylarını
    booking'in karşı katılımcısına relay eder. Geçersiz/yetkisiz mesajlar sessizce
    yok sayılır (best-effort)."""
    try:
        msg = json.loads(raw)
    except (ValueError, TypeError):
        return
    if not isinstance(msg, dict) or msg.get("type") != "RTC_SIGNAL":
        return
    booking_id = msg.get("booking_id")
    signal = msg.get("signal")
    if not isinstance(booking_id, int) or signal is None:
        return

    async with AsyncSessionLocal() as session:
        target = await booking_service.resolve_signal_target(
            session, booking_id, user_id, role_id
        )
    if target is None:
        return  # yetkisiz / pasif ders

    target_user_id, target_role_id = target
    await manager.send_personal_message(
        {
            "type": "RTC_SIGNAL",
            "booking_id": booking_id,
            "from": {"user_id": user_id, "role_id": role_id},
            "signal": signal,
        },
        target_user_id,
        target_role_id,
    )
