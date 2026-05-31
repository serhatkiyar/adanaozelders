from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUser, get_current_active_user, user_rate_limit
from core.config import settings
from core.database import get_db
from schemas.messaging import ConversationOut, MessageCreate, MessageOut
from services import messaging_service

router = APIRouter(prefix="/messages", tags=["messages"])

_send_limit = user_rate_limit(
    key="message_send",
    limit=settings.RATE_LIMIT_MESSAGE,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await messaging_service.list_conversations(db, user)


@router.get("/unread-count", response_model=int)
async def unread_count(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await messaging_service.unread_total(db, user)


@router.post(
    "/conversations/{conversation_id}/read",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def mark_conversation_read(
    conversation_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await messaging_service.mark_read(db, user, conversation_id)


@router.get("/conversations/{conversation_id}", response_model=list[MessageOut])
async def list_messages(
    conversation_id: int,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await messaging_service.list_messages(
        db, user, conversation_id, limit=limit, offset=offset
    )


@router.post(
    "/{counterparty_id}",
    response_model=MessageOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_send_limit)],
)
async def send_message(
    counterparty_id: int,
    payload: MessageCreate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await messaging_service.send_message(
        db, sender=user, counterparty_id=counterparty_id, body=payload.body
    )
