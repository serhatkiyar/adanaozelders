"""İP-16 — Aralıklı tekrar (FSRS-5) HTTP uçları.

Bu router İNCE bir katmandır: iş kuralının tamamı `services/srs_service.py`
içindedir (kök CLAUDE.md kuralı). Burada yalnız yol, doğrulama (schemas/srs),
yetki kapısı ve hız sınırı vardır.

Yetki notları:

* Kullanıcı uçlarında **rol kapısı YOKTUR**. Bilinçli: D-7 admin'in kullanıcı
  yüzeylerinden **404** almasını ister (403 değil — varlık sızdırmamak İP-3
  deseni). `require_roles(...)` koysaydık admin 403 alır ve "böyle bir deste
  var ama sana kapalı" bilgisi sızardı; servis zaten admin'e 404 verir.
* Platform (admin) uçları izin kataloğundan geçer:
  `require_admin_method_permission("srs_platform.view", "srs_platform.manage")`
  — GET'te view, mutasyonda manage.

**ROTA SIRASI KRİTİK**: `/decks/platform` sabit yolu `/decks/{deck_id}`
parametreli yolundan ÖNCE tanımlanmalıdır (kütüphane router'ındaki bilinen
tuzak); aksi halde "platform" bir deck_id sanılıp 422 döner.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import (
    CurrentUser,
    get_current_active_user,
    require_admin_method_permission,
    user_rate_limit,
)
from core.config import settings
from core.database import get_db
from schemas.srs import (
    AnswerIn,
    AnswerOut,
    AssignIn,
    AssignmentListOut,
    AssignOut,
    BulkIn,
    BulkOut,
    CardListOut,
    DeckCreate,
    DeckItemsOut,
    DeckListOut,
    DeckOut,
    DeckUpdate,
    NoteCreate,
    NoteOut,
    NoteUpdate,
    PlatformDeckCreate,
    ProgressState,
    QueueOut,
    StatsOut,
    TagListOut,
    UndoOut,
)
from services import srs_service

router = APIRouter(prefix="/srs", tags=["srs"])

#: Yazma uçlarında kullanıcı bazlı hız sınırı (sözleşme §8).
_write_limit = user_rate_limit(
    key="srs",
    limit=settings.RATE_LIMIT_TASK,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)

#: Platform (admin) uçlarının izin kapısı — GET view, mutasyon manage.
_platform_guard = require_admin_method_permission(
    "srs_platform.view", "srs_platform.manage"
)


# ── ADMIN: platform desteleri (parametreli /decks yollarından ÖNCE) ─────────


@router.get("/admin/platform-decks", response_model=DeckItemsOut)
async def admin_list_platform_decks(
    _admin: CurrentUser = Depends(_platform_guard),
    db: AsyncSession = Depends(get_db),
):
    return {"items": await srs_service.list_platform_decks_admin(db)}


@router.post(
    "/admin/platform-decks",
    response_model=DeckOut,
    status_code=status.HTTP_201_CREATED,
)
async def admin_create_platform_deck(
    payload: PlatformDeckCreate,
    admin: CurrentUser = Depends(_platform_guard),
    db: AsyncSession = Depends(get_db),
):
    return await srs_service.create_platform_deck(
        db,
        admin,
        name=payload.name,
        description=payload.description,
        parent_id=payload.parent_id,
        new_per_day=payload.new_per_day,
        reviews_per_day=payload.reviews_per_day,
    )


@router.patch("/admin/platform-decks/{deck_id}", response_model=DeckOut)
async def admin_update_platform_deck(
    deck_id: int,
    payload: DeckUpdate,
    admin: CurrentUser = Depends(_platform_guard),
    db: AsyncSession = Depends(get_db),
):
    return await srs_service.update_platform_deck(
        db, admin, deck_id, payload.model_dump(exclude_unset=True)
    )


@router.delete(
    "/admin/platform-decks/{deck_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def admin_delete_platform_deck(
    deck_id: int,
    admin: CurrentUser = Depends(_platform_guard),
    db: AsyncSession = Depends(get_db),
):
    await srs_service.delete_platform_deck(db, admin, deck_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/admin/platform-decks/{deck_id}/notes",
    response_model=NoteOut,
    status_code=status.HTTP_201_CREATED,
)
async def admin_create_platform_note(
    deck_id: int,
    payload: NoteCreate,
    admin: CurrentUser = Depends(_platform_guard),
    db: AsyncSession = Depends(get_db),
):
    return await srs_service.create_platform_note(
        db,
        admin,
        deck_id,
        note_type=payload.note_type,
        front=payload.front,
        back=payload.back,
        tags=payload.tags,
    )


# ── Desteler ────────────────────────────────────────────────────────────────


@router.get("/decks/platform", response_model=DeckItemsOut)
async def list_platform_decks(
    _user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return {"items": await srs_service.list_platform_decks(db)}


@router.get("/decks", response_model=DeckListOut)
async def list_decks(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await srs_service.list_decks(db, user)


@router.post(
    "/decks",
    response_model=DeckOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_write_limit)],
)
async def create_deck(
    payload: DeckCreate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await srs_service.create_deck(
        db,
        user,
        name=payload.name,
        description=payload.description,
        parent_id=payload.parent_id,
        new_per_day=payload.new_per_day,
        reviews_per_day=payload.reviews_per_day,
    )


@router.get("/decks/{deck_id}", response_model=DeckOut)
async def get_deck(
    deck_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await srs_service.get_deck(db, user, deck_id)


@router.patch(
    "/decks/{deck_id}",
    response_model=DeckOut,
    dependencies=[Depends(_write_limit)],
)
async def update_deck(
    deck_id: int,
    payload: DeckUpdate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await srs_service.update_deck(
        db, user, deck_id, payload.model_dump(exclude_unset=True)
    )


@router.delete(
    "/decks/{deck_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(_write_limit)],
)
async def delete_deck(
    deck_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await srs_service.delete_deck(db, user, deck_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/decks/{deck_id}/copy",
    response_model=DeckOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_write_limit)],
)
async def copy_deck(
    deck_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await srs_service.copy_deck(db, user, deck_id)


# ── Atama (K-6: yalnız varlık bilgisi döner) ────────────────────────────────


@router.post(
    "/decks/{deck_id}/assign",
    response_model=AssignOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_write_limit)],
)
async def assign_deck(
    deck_id: int,
    payload: AssignIn,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    assignment = await srs_service.assign_deck(db, user, deck_id, payload.client_id)
    return {
        "deck_id": assignment.deck_id,
        "client_id": assignment.client_id,
        "assigned_at": assignment.created_at,
    }


@router.delete(
    "/decks/{deck_id}/assign/{client_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(_write_limit)],
)
async def unassign_deck(
    deck_id: int,
    client_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await srs_service.unassign_deck(db, user, deck_id, client_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/decks/{deck_id}/assignments", response_model=AssignmentListOut)
async def list_assignments(
    deck_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return {"items": await srs_service.list_assignments(db, user, deck_id)}


# ── Notlar ──────────────────────────────────────────────────────────────────


@router.post(
    "/decks/{deck_id}/notes",
    response_model=NoteOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_write_limit)],
)
async def create_note(
    deck_id: int,
    payload: NoteCreate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await srs_service.create_note(
        db,
        user,
        deck_id,
        note_type=payload.note_type,
        front=payload.front,
        back=payload.back,
        tags=payload.tags,
    )


@router.patch(
    "/notes/{note_id}",
    response_model=NoteOut,
    dependencies=[Depends(_write_limit)],
)
async def update_note(
    note_id: int,
    payload: NoteUpdate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await srs_service.update_note(
        db, user, note_id, payload.model_dump(exclude_unset=True)
    )


@router.delete(
    "/notes/{note_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(_write_limit)],
)
async def delete_note(
    note_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await srs_service.delete_note(db, user, note_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Etiketler ───────────────────────────────────────────────────────────────


@router.get("/tags", response_model=TagListOut)
async def list_tags(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return {"items": await srs_service.list_tags(db, user)}


# ── Kart tarayıcı (sunucu filtre + sayfalama, B matrisi) ────────────────────


@router.get("/cards", response_model=CardListOut)
async def browse_cards(
    deck_id: int | None = Query(default=None),
    state: ProgressState | None = Query(default=None),
    tag: str | None = Query(default=None, max_length=100),
    q: str | None = Query(default=None, max_length=200),
    suspended: bool | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    items, total = await srs_service.browse_cards(
        db,
        user,
        deck_id=deck_id,
        state=state,
        tag=tag,
        q=q,
        suspended=suspended,
        page=page,
        page_size=page_size,
    )
    return {"items": items, "total": total}


@router.post(
    "/cards/bulk", response_model=BulkOut, dependencies=[Depends(_write_limit)]
)
async def bulk_cards(
    payload: BulkIn,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await srs_service.bulk_action(
        db,
        user,
        payload.ids,
        payload.action,
        target_deck_id=payload.target_deck_id,
        tag=payload.tag,
    )


# ── Çalışma oturumu ─────────────────────────────────────────────────────────


@router.get("/study/queue", response_model=QueueOut)
async def study_queue(
    deck_id: int = Query(...),
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await srs_service.study_queue(db, user, deck_id)


@router.post(
    "/study/answer", response_model=AnswerOut, dependencies=[Depends(_write_limit)]
)
async def answer(
    payload: AnswerIn,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await srs_service.answer(
        db, user, payload.card_id, payload.rating, payload.client_token
    )


@router.post(
    "/study/undo", response_model=UndoOut, dependencies=[Depends(_write_limit)]
)
async def undo(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await srs_service.undo(db, user)


# ── İstatistik (K-6: YALNIZ kendi verisi) ───────────────────────────────────


@router.get("/stats", response_model=StatsOut)
async def stats(
    deck_id: int | None = Query(default=None),
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await srs_service.stats(db, user, deck_id)
