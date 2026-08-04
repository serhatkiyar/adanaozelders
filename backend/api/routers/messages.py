from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUser, get_current_active_user, user_rate_limit
from core.config import settings
from core.database import get_db
from models.role import ROLE_IDS, RoleType
from schemas.messaging import (
    ConversationOut,
    MessageCreate,
    MessageOut,
    MessageSearchResults,
    MessagesUnreadCounts,
    ReactionOut,
    ReactionRequest,
)
from services import messaging_service, phone_service

router = APIRouter(prefix="/messages", tags=["messages"])

_send_limit = user_rate_limit(
    key="message_send",
    limit=settings.RATE_LIMIT_MESSAGE,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    archived: bool = Query(default=False),
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await messaging_service.list_conversations(db, user, archived=archived)


@router.get("/search", response_model=MessageSearchResults)
async def search_messages(
    q: str = Query(min_length=1, max_length=100),
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await messaging_service.search_messages(db, user, q)


@router.post(
    "/conversations/{conversation_id}/archive",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def archive_conversation(
    conversation_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await messaging_service.set_archived(db, user, conversation_id, True)


@router.post(
    "/conversations/{conversation_id}/unarchive",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def unarchive_conversation(
    conversation_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await messaging_service.set_archived(db, user, conversation_id, False)


@router.post("/items/{message_id}/reactions", response_model=list[ReactionOut])
async def toggle_reaction(
    message_id: int,
    payload: ReactionRequest,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await messaging_service.toggle_reaction(
        db, user, message_id, payload.emoji
    )


@router.get("/unread-count", response_model=MessagesUnreadCounts)
async def unread_count(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await messaging_service.unread_counts(db, user)


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
    # Telefon kapısı öğrenci/eğitmen için (anti-spam). Operatör muafiyeti,
    # kütüphanesi ACTIVE (admin onaylı) olduğu için savunulabilir: onaysız
    # operatör servisteki `_assert_sender_library_active` kapısına takılır
    # (İP-3 §1.1 — self-servis kayıt "admin oluşturur" varsayımını geçersiz kıldı).
    if user.role_id != ROLE_IDS[RoleType.LIBRARY_OPERATOR]:
        phone_service.require_phone_verified(user)
    # Alıcı türü verilmezse gönderene göre çıkar (CLIENT→TUTOR, TUTOR→CLIENT).
    role = payload.counterparty_role
    if role is None:
        if user.role_id == ROLE_IDS[RoleType.CLIENT]:
            role = "TUTOR"
        elif user.role_id == ROLE_IDS[RoleType.TUTOR]:
            role = "CLIENT"
        else:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "counterparty_role zorunlu"
            )
    return await messaging_service.send_message(
        db,
        sender=user,
        counterparty_role=role,
        counterparty_id=counterparty_id,
        body=payload.body,
        reply_to_id=payload.reply_to_id,
    )
