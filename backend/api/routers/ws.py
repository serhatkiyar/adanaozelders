from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
import jwt

from core.ws_manager import manager
from core.database import get_db
from core.security import decode_access_token
from models.admin import Admin
from models.client import Client
from models.tutor import Tutor
from models.role import RoleType

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
            
    except Exception:
        await websocket.close(code=1008)
        return

    await manager.connect(websocket, user_id, role_id)
    try:
        while True:
            # We don't expect the client to send anything, but we keep the connection open
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, user_id, role_id)
