from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUser, get_current_active_user, require_roles
from core.database import get_db
from models.client import Client
from models.qa import QAStatus, QAThread
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from schemas.qa import (
    LessonQuestionGroup,
    QAAnswer,
    QAMessageCreate,
    QAThreadCreate,
    QAThreadOut,
)
from services import qa_service

router = APIRouter(prefix="/qa", tags=["qa"])


async def _get_thread_or_404(db: AsyncSession, thread_id: int) -> QAThread:
    thread = await qa_service.get_thread(db, thread_id)
    if thread is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Thread not found")
    return thread


def _assert_party(thread: QAThread, user: CurrentUser) -> None:
    if user.role_id == ROLE_IDS[RoleType.CLIENT] and thread.client_id == user.id:
        return
    if user.role_id == ROLE_IDS[RoleType.TUTOR] and thread.tutor_id == user.id:
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your thread")


@router.post("", response_model=QAThreadOut, status_code=status.HTTP_201_CREATED)
async def ask_question(
    payload: QAThreadCreate,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await qa_service.create_thread(db, client, payload)


@router.get("", response_model=list[QAThreadOut])
async def list_threads(
    status_filter: QAStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await qa_service.list_threads(
        db,
        role_id=user.role_id,
        user_id=user.id,
        status_filter=status_filter,
        limit=limit,
        offset=offset,
    )


@router.get("/rights", response_model=list[LessonQuestionGroup])
async def list_question_rights(
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await qa_service.list_question_rights(db, client)


@router.get("/{thread_id}", response_model=QAThreadOut)
async def get_thread(
    thread_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    thread = await _get_thread_or_404(db, thread_id)
    _assert_party(thread, user)
    return thread


@router.post("/{thread_id}/messages", response_model=QAThreadOut)
async def post_message(
    thread_id: int,
    payload: QAMessageCreate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    thread = await _get_thread_or_404(db, thread_id)
    _assert_party(thread, user)
    sender_role = (
        "CLIENT" if user.role_id == ROLE_IDS[RoleType.CLIENT] else "TUTOR"
    )
    return await qa_service.post_message(
        db, thread, sender_role=sender_role, body=payload.body
    )


@router.post("/{thread_id}/answer", response_model=QAThreadOut)
async def answer_thread(
    thread_id: int,
    payload: QAAnswer,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    thread = await _get_thread_or_404(db, thread_id)
    if thread.tutor_id != tutor.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your thread")
    return await qa_service.answer_thread(db, thread, payload.answer)


@router.post("/{thread_id}/close", response_model=QAThreadOut)
async def close_thread(
    thread_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    thread = await _get_thread_or_404(db, thread_id)
    _assert_party(thread, user)
    return await qa_service.close_thread(db, thread)
