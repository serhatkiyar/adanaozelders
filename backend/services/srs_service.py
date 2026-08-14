"""İP-16 — Aralıklı tekrar (FSRS-5) servis katmanı.

Router'lar bu modülün üstünde İNCE bir HTTP katmanıdır; iş kuralının tamamı
buradadır (kök CLAUDE.md kuralı). Saf planlayıcı çekirdeği
`services/spaced_repetition` (engine/params/dayboundary/queuerules) DB bilmez;
bu katman DB durumunu çekirdeğe çevirir ve sonucu geri yazar.

Zaman sözleşmesi: BÜTÜN zaman okumaları modül düzeyi ``_now()`` üzerindendir —
testler `monkeypatch.setattr(srs_service, "_now", ...)` ile sabitler
(tests/integration/ip16_factory.py). Başka yerde ``datetime.now`` çağrılmaz.

Güvenlik sözleşmeleri:

* Sahiplik ``(user_id, role_id)`` çifti; yabancı kaynak → **404** (İP-3
  deseni, varlık sızdırmaz: 403 "vardır ama senin değil" der, 404 demez).
* K-6: ilerleme verisi YALNIZ sahibinindir. Buradaki her progress/log
  sorgusu ``user_id = :current ∧ role_id = :current_role`` filtresi taşır;
  başka kullanıcının ilerlemesini okuyan tek bir sorgu yoktur.
* S-1/S-2: cevap ucu idempotent — log satırı kısmi unique (user, role,
  client_token) üzerinden ``ON CONFLICT DO NOTHING`` claim'idir (İP-1a
  escrow.claim deseninin insert karşılığı); progress güncellemesi aynı
  transaction'dadır ve satır kilidiyle (FOR UPDATE) serileşir.
"""
from __future__ import annotations

import dataclasses
import datetime
import re
import uuid as uuid_mod

from fastapi import HTTPException, status
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from api.deps import CurrentUser
from models.booking import Booking, BookingStatus
from models.client import Client
from models.srs import (
    NOTE_TYPES,
    PROGRESS_STATES,
    SrsCard,
    SrsDeck,
    SrsDeckAssignment,
    SrsNote,
    SrsNoteTag,
    SrsProgress,
    SrsReviewLog,
    SrsTag,
)
from services.spaced_repetition import dayboundary, engine, params, queuerules

ROLE_ADMIN = 1
ROLE_TUTOR = 2
ROLE_CLIENT = 3

# Anki varsayılanı: başka iş kalmadıysa vadesine <= 20 dk kalmış öğrenme kartı
# erken gösterilir (sözleşme §4.1). Sayaçlar da bu pencereyle uyumludur.
LEARN_AHEAD_MINUTES = int(queuerules.LEARN_AHEAD_MINUTES)

_MAX_PAGE_SIZE = 200


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _404(detail: str = "Kaynak bulunamadı") -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail)


def _422(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail)


# ── Saf çekirdek köprüleri ───────────────────────────────────────────────────


def _phase_value(phase: object) -> str:
    """Engine phase'i (enum ya da str) DB string'ine indirger."""
    return str(getattr(phase, "value", phase)).upper()


def _phase_for_engine(state_str: str) -> object:
    """DB string'ini engine'in phase tipine çevirir (enum ise enum üyesi)."""
    sample = getattr(engine.SrsCardState.new(), "phase", None)
    if sample is None or isinstance(sample, str):
        return state_str
    cls = type(sample)
    try:
        return cls(state_str)
    except ValueError:
        return cls[state_str]


def _engine_state(progress: SrsProgress | None) -> object:
    """Progress satırından (yoksa NEW) engine durumu kurar.

    Alan adları dataclass'tan okunur — çekirdek paralel geliştirildiği için
    ad eşlemesi (phase/state, due/due_at, last_review/last_review_at) burada
    tek yerde yapılır.
    """
    if progress is None or progress.state == "NEW":
        return engine.SrsCardState.new()
    values = {
        "phase": _phase_for_engine(progress.state),
        "state": _phase_for_engine(progress.state),
        "step": progress.step,
        "stability": progress.stability,
        "difficulty": progress.difficulty,
        "due": progress.due_at,
        "due_at": progress.due_at,
        "last_review": progress.last_review_at,
        "last_review_at": progress.last_review_at,
        "reps": progress.reps,
        "lapses": progress.lapses,
    }
    field_names = [f.name for f in dataclasses.fields(engine.SrsCardState)]
    return engine.SrsCardState(**{n: values[n] for n in field_names if n in values})


def _gecen_calisma_gunu(
    progress: SrsProgress | None, now: datetime.datetime
) -> int:
    """Son cevaptan bu yana geçen ÇALIŞMA günü sayısı (H3 tek tabanı).

    Motor takvim aritmetiği yapmaz; geçen gün sayısını burası verir ve tabanı
    kuyruğunkiyle aynı tutar (`dayboundary.study_day` = TR yereli − 4 saat).
    Takvim farkı (`(now - last_review).days`) kullanılsaydı Pazartesi 20:00'de
    cevaplanıp Salı 09:00'da tekrar cevaplanan kart "aynı gün" sayılırdı —
    kuyruk ise onu ertesi günün kartı olarak gösterir.
    """
    if progress is None or progress.last_review_at is None:
        return 0
    return max(
        0,
        (
            dayboundary.study_day(now)
            - dayboundary.study_day(progress.last_review_at)
        ).days,
    )


def _effective_limits(chain: list[SrsDeck]) -> tuple[int, int]:
    """Zincirin efektif (yeni, tekrar) limitleri — L-3 kalıtımı çekirdekte."""
    new_limit, review_limit = queuerules.effective_limits(
        (d.new_per_day, d.reviews_per_day) for d in chain
    )
    return int(new_limit), int(review_limit)


# ── Deste erişimi (İP-3 deseni: yabancı → 404) ───────────────────────────────


async def _get_live_deck(db: AsyncSession, deck_id: int) -> SrsDeck | None:
    deck = await db.get(SrsDeck, deck_id)
    if deck is None or deck.deleted_at is not None:
        return None
    return deck


def _is_owner(deck: SrsDeck, user: CurrentUser) -> bool:
    return deck.owner_user_id == user.id and deck.owner_role_id == user.role_id


async def _is_assigned(db: AsyncSession, deck_id: int, user: CurrentUser) -> bool:
    if user.role_id != ROLE_CLIENT:
        return False
    row = await db.execute(
        select(SrsDeckAssignment.id).where(
            SrsDeckAssignment.deck_id == deck_id,
            SrsDeckAssignment.client_id == user.id,
            SrsDeckAssignment.deleted_at.is_(None),
        )
    )
    return row.first() is not None


async def _owned_deck_or_404(
    db: AsyncSession, user: CurrentUser, deck_id: int
) -> SrsDeck:
    deck = await _get_live_deck(db, deck_id)
    if deck is None or not _is_owner(deck, user):
        raise _404("Deste bulunamadı")
    return deck


async def _visible_deck_or_404(
    db: AsyncSession, user: CurrentUser, deck_id: int
) -> SrsDeck:
    """Sahip VEYA atanmış öğrenci VEYA platform destesi → görünür; yoksa 404."""
    deck = await _get_live_deck(db, deck_id)
    if deck is None:
        raise _404("Deste bulunamadı")
    if _is_owner(deck, user):
        return deck
    if deck.visibility == "PLATFORM":
        return deck
    if await _is_assigned(db, deck.id, user):
        return deck
    raise _404("Deste bulunamadı")


async def _study_deck_or_404(
    db: AsyncSession, user: CurrentUser, deck_id: int
) -> SrsDeck:
    """Çalışma yüzeyleri: admin'in çalışma kuyruğu YOKTUR (D-7) → 404."""
    if user.role_id == ROLE_ADMIN:
        raise _404("Deste bulunamadı")
    return await _visible_deck_or_404(db, user, deck_id)


async def deck_chain(db: AsyncSession, deck: SrsDeck) -> list[SrsDeck]:
    """Kökten seçili desteye limit zinciri (L-3 kalıtım girdisi)."""
    chain: list[SrsDeck] = [deck]
    seen = {deck.id}
    current = deck
    while current.parent_id is not None and current.parent_id not in seen:
        parent = await db.get(SrsDeck, current.parent_id)
        if parent is None or parent.deleted_at is not None:
            break
        chain.append(parent)
        seen.add(parent.id)
        current = parent
    chain.reverse()
    return chain


async def _subtree_ids(db: AsyncSession, deck: SrsDeck) -> list[int]:
    """Deste + tüm alt desteler (D-11). Deste sayısı küçük — Python BFS yeter."""
    ids = [deck.id]
    frontier = [deck.id]
    while frontier:
        rows = await db.execute(
            select(SrsDeck.id).where(
                SrsDeck.parent_id.in_(frontier), SrsDeck.deleted_at.is_(None)
            )
        )
        frontier = [r[0] for r in rows if r[0] not in ids]
        ids.extend(frontier)
    return ids


# ── Deste CRUD ───────────────────────────────────────────────────────────────


async def create_deck(
    db: AsyncSession,
    user: CurrentUser,
    *,
    name: str,
    description: str | None = None,
    parent_id: int | None = None,
    new_per_day: int | None = None,
    reviews_per_day: int | None = None,
    visibility: str = "PRIVATE",
) -> SrsDeck:
    if parent_id is not None:
        await _owned_deck_or_404(db, user, parent_id)
    if visibility != "PLATFORM" or user.role_id != ROLE_ADMIN:
        visibility = "PRIVATE"
    deck = SrsDeck(
        owner_user_id=user.id,
        owner_role_id=user.role_id,
        parent_id=parent_id,
        name=name.strip(),
        description=(description or "").strip() or None,
        visibility=visibility,
        new_per_day=new_per_day,
        reviews_per_day=reviews_per_day,
    )
    db.add(deck)
    await db.flush()
    return deck


async def list_decks(db: AsyncSession, user: CurrentUser) -> dict:
    """Kendi ağacı + (CLIENT ise) atananlar. Platform galerisi ayrı uçtadır."""
    own = list(
        (
            await db.execute(
                select(SrsDeck)
                .where(
                    SrsDeck.owner_user_id == user.id,
                    SrsDeck.owner_role_id == user.role_id,
                    SrsDeck.deleted_at.is_(None),
                )
                .order_by(SrsDeck.id)
            )
        ).scalars().all()
    )
    assigned: list[SrsDeck] = []
    if user.role_id == ROLE_CLIENT:
        assigned = list(
            (
                await db.execute(
                    select(SrsDeck)
                    .join(SrsDeckAssignment, SrsDeckAssignment.deck_id == SrsDeck.id)
                    .where(
                        SrsDeckAssignment.client_id == user.id,
                        SrsDeckAssignment.deleted_at.is_(None),
                        SrsDeck.deleted_at.is_(None),
                    )
                    .order_by(SrsDeck.id)
                )
            ).scalars().all()
        )
    return {"own": own, "assigned": assigned}


async def list_platform_decks(db: AsyncSession) -> list[SrsDeck]:
    return list(
        (
            await db.execute(
                select(SrsDeck)
                .where(SrsDeck.visibility == "PLATFORM", SrsDeck.deleted_at.is_(None))
                .order_by(SrsDeck.id)
            )
        ).scalars().all()
    )


async def get_deck(db: AsyncSession, user: CurrentUser, deck_id: int) -> SrsDeck:
    return await _visible_deck_or_404(db, user, deck_id)


def _apply_deck_changes(deck: SrsDeck, changes: dict) -> None:
    if "name" in changes and changes["name"]:
        deck.name = str(changes["name"]).strip()
    if "description" in changes:
        deck.description = (changes["description"] or "").strip() or None
    if "new_per_day" in changes:
        deck.new_per_day = changes["new_per_day"]
    if "reviews_per_day" in changes:
        deck.reviews_per_day = changes["reviews_per_day"]


async def update_deck(
    db: AsyncSession, user: CurrentUser, deck_id: int, changes: dict
) -> SrsDeck:
    deck = await _owned_deck_or_404(db, user, deck_id)
    if "parent_id" in changes:
        new_parent = changes["parent_id"]
        if new_parent is not None:
            parent = await _owned_deck_or_404(db, user, new_parent)
            # Döngü koruması: yeni ebeveyn, destenin kendi alt-ağacında olamaz.
            if parent.id in await _subtree_ids(db, deck):
                raise _422("Deste kendi alt-ağacına taşınamaz")
        deck.parent_id = new_parent
    _apply_deck_changes(deck, changes)
    await db.flush()
    return deck


async def _soft_delete_subtree(db: AsyncSession, deck: SrsDeck) -> None:
    now = _now()
    ids = await _subtree_ids(db, deck)
    await db.execute(
        update(SrsCard)
        .where(SrsCard.deck_id.in_(ids), SrsCard.deleted_at.is_(None))
        .values(deleted_at=now)
        .execution_options(synchronize_session=False)
    )
    await db.execute(
        update(SrsNote)
        .where(SrsNote.deck_id.in_(ids), SrsNote.deleted_at.is_(None))
        .values(deleted_at=now)
        .execution_options(synchronize_session=False)
    )
    await db.execute(
        update(SrsDeck)
        .where(SrsDeck.id.in_(ids), SrsDeck.deleted_at.is_(None))
        .values(deleted_at=now)
        .execution_options(synchronize_session=False)
    )


async def delete_deck(db: AsyncSession, user: CurrentUser, deck_id: int) -> None:
    deck = await _owned_deck_or_404(db, user, deck_id)
    await _soft_delete_subtree(db, deck)
    await db.flush()


# ── Atama (eğitmen → öğrenci; sözleşme §7.1) ─────────────────────────────────


async def assign_deck(
    db: AsyncSession, user: CurrentUser, deck_id: int, client_id: int
) -> SrsDeckAssignment:
    if user.role_id != ROLE_TUTOR:
        raise _404("Deste bulunamadı")
    deck = await _owned_deck_or_404(db, user, deck_id)
    client = await db.get(Client, client_id)
    if client is None or client.deleted_at is not None:
        raise _404("Öğrenci bulunamadı")
    # Atama kapısı: aralarında iptal-edilmemiş en az bir rezervasyon şart.
    bag = await db.execute(
        select(Booking.id)
        .where(
            Booking.tutor_id == user.id,
            Booking.client_id == client_id,
            Booking.deleted_at.is_(None),
            Booking.status.notin_((BookingStatus.CANCELLED, BookingStatus.REJECTED)),
        )
        .limit(1)
    )
    if bag.first() is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Bu öğrenciyle aranızda aktif bir ders bağı yok",
        )
    existing = (
        await db.execute(
            select(SrsDeckAssignment).where(
                SrsDeckAssignment.deck_id == deck.id,
                SrsDeckAssignment.client_id == client_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing.deleted_at = None
        await db.flush()
        return existing
    assignment = SrsDeckAssignment(
        deck_id=deck.id, client_id=client_id, assigned_by_tutor_id=user.id
    )
    db.add(assignment)
    await db.flush()
    return assignment


async def unassign_deck(
    db: AsyncSession, user: CurrentUser, deck_id: int, client_id: int
) -> None:
    if user.role_id != ROLE_TUTOR:
        raise _404("Deste bulunamadı")
    deck = await _owned_deck_or_404(db, user, deck_id)
    result = await db.execute(
        delete(SrsDeckAssignment).where(
            SrsDeckAssignment.deck_id == deck.id,
            SrsDeckAssignment.client_id == client_id,
        )
    )
    if result.rowcount == 0:
        raise _404("Atama bulunamadı")


async def list_assignments(
    db: AsyncSession, user: CurrentUser, deck_id: int
) -> list[dict]:
    """YALNIZ atama varlığı (K-6): ilerleme alanı bu yanıta ASLA girmez."""
    if user.role_id != ROLE_TUTOR:
        raise _404("Deste bulunamadı")
    deck = await _owned_deck_or_404(db, user, deck_id)
    rows = await db.execute(
        select(SrsDeckAssignment, Client)
        .join(Client, Client.id == SrsDeckAssignment.client_id)
        .where(
            SrsDeckAssignment.deck_id == deck.id,
            SrsDeckAssignment.deleted_at.is_(None),
        )
        .order_by(SrsDeckAssignment.id)
    )
    return [
        {
            "client_id": a.client_id,
            "client_name": c.full_name,
            "assigned_at": a.created_at,
        }
        for a, c in rows.all()
    ]


# ── Kopya (K-7 bağımsızlık) ──────────────────────────────────────────────────


async def copy_deck(
    db: AsyncSession, user: CurrentUser, source_deck_id: int
) -> SrsDeck:
    """Deste + alt desteler + notlar + kartlar derin kopya; İLERLEME TAŞINMAZ.

    Kaynak: platform destesi, kendisine atanmış deste ya da kendi destesi —
    hepsi `_visible_deck_or_404` kuralının kendisi.
    """
    source = await _visible_deck_or_404(db, user, source_deck_id)
    src_ids = await _subtree_ids(db, source)
    src_decks = {
        d.id: d
        for d in (
            await db.execute(
                select(SrsDeck).where(SrsDeck.id.in_(src_ids)).order_by(SrsDeck.id)
            )
        ).scalars()
    }
    deck_map: dict[int, SrsDeck] = {}

    def _copy_one(src: SrsDeck, parent_new_id: int | None) -> SrsDeck:
        return SrsDeck(
            owner_user_id=user.id,
            owner_role_id=user.role_id,
            parent_id=parent_new_id,
            name=src.name,
            description=src.description,
            visibility="PRIVATE",
            new_per_day=src.new_per_day,
            reviews_per_day=src.reviews_per_day,
            copied_from_id=src.id,
        )

    # Kökten aşağı: ebeveyn kopyası her zaman çocuktan önce yaratılır.
    pending = [source.id]
    while pending:
        sid = pending.pop(0)
        src = src_decks[sid]
        parent_new = None
        if sid != source.id and src.parent_id in deck_map:
            parent_new = deck_map[src.parent_id].id
        new_deck = _copy_one(src, parent_new)
        db.add(new_deck)
        await db.flush()
        deck_map[sid] = new_deck
        pending.extend(d.id for d in src_decks.values() if d.parent_id == sid)

    notes = (
        await db.execute(
            select(SrsNote)
            .where(SrsNote.deck_id.in_(src_ids), SrsNote.deleted_at.is_(None))
            .order_by(SrsNote.id)
        )
    ).scalars().all()
    for note in notes:
        new_note = SrsNote(
            deck_id=deck_map[note.deck_id].id,
            note_type=note.note_type,
            front=note.front,
            back=note.back,
        )
        db.add(new_note)
        await db.flush()
        cards = (
            await db.execute(
                select(SrsCard).where(
                    SrsCard.note_id == note.id, SrsCard.deleted_at.is_(None)
                )
            )
        ).scalars().all()
        for card in cards:
            target = deck_map.get(card.deck_id, deck_map[note.deck_id])
            db.add(
                SrsCard(
                    note_id=new_note.id,
                    deck_id=target.id,
                    template_ord=card.template_ord,
                )
            )
    await db.flush()
    return deck_map[source.id]


# ── Not / kart türetimi (sözleşme §6) ────────────────────────────────────────

_CLOZE_RE = re.compile(r"\{\{c(\d+)::(.*?)\}\}", re.S)


def _cloze_ords(front: str) -> list[int]:
    matches = list(_CLOZE_RE.finditer(front))
    for m in matches:
        if "{{" in m.group(2):
            raise _422("İç içe cloze desteklenmez")
    if not matches:
        raise _422("Cloze notunda en az bir {{cN::...}} boşluğu olmalı")
    numbers = sorted({int(m.group(1)) for m in matches})
    if numbers[0] < 1:
        raise _422("Cloze numaraları 1'den başlar")
    return [n - 1 for n in numbers]


def _note_ords(note_type: str, front: str) -> list[int]:
    if note_type == "BASIC_REVERSED":
        return [0, 1]
    if note_type == "CLOZE":
        return _cloze_ords(front)
    return [0]  # BASIC / TYPE_IN


def _card_faces(note: SrsNote, template_ord: int) -> tuple[str, str]:
    if note.note_type == "BASIC_REVERSED" and template_ord == 1:
        return note.back, note.front
    return note.front, note.back


async def _note_deck_or_404(
    db: AsyncSession, user: CurrentUser, deck_id: int
) -> SrsDeck:
    """Not yazma yetkisi: deste sahibi VEYA (admin ∧ platform destesi)."""
    deck = await _get_live_deck(db, deck_id)
    if deck is None:
        raise _404("Deste bulunamadı")
    if _is_owner(deck, user):
        return deck
    if user.role_id == ROLE_ADMIN and deck.visibility == "PLATFORM":
        return deck
    raise _404("Deste bulunamadı")


async def _upsert_tag(db: AsyncSession, user: CurrentUser, name: str) -> SrsTag:
    clean = name.strip()
    tag = (
        await db.execute(
            select(SrsTag).where(
                SrsTag.owner_user_id == user.id,
                SrsTag.owner_role_id == user.role_id,
                func.lower(SrsTag.name) == clean.lower(),
                SrsTag.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if tag is not None:
        return tag
    tag = SrsTag(owner_user_id=user.id, owner_role_id=user.role_id, name=clean)
    db.add(tag)
    await db.flush()
    return tag


async def _link_note_tags(
    db: AsyncSession, user: CurrentUser, note_id: int, tag_names: list[str]
) -> None:
    for raw in tag_names:
        if not raw or not raw.strip():
            continue
        tag = await _upsert_tag(db, user, raw)
        await db.execute(
            pg_insert(SrsNoteTag)
            .values(note_id=note_id, tag_id=tag.id)
            .on_conflict_do_nothing(index_elements=["note_id", "tag_id"])
        )


async def create_note(
    db: AsyncSession,
    user: CurrentUser,
    deck_id: int,
    *,
    note_type: str,
    front: str,
    back: str,
    tags: list[str] | None = None,
) -> SrsNote:
    deck = await _note_deck_or_404(db, user, deck_id)
    if note_type not in NOTE_TYPES:
        raise _422("Geçersiz not tipi")
    if not front or not front.strip():
        raise _422("Ön yüz boş olamaz")
    ords = _note_ords(note_type, front)  # kart türetimi SENKRON (T-1..T-3)
    note = SrsNote(
        deck_id=deck.id, note_type=note_type, front=front, back=back or ""
    )
    db.add(note)
    await db.flush()
    for template_ord in ords:
        db.add(SrsCard(note_id=note.id, deck_id=deck.id, template_ord=template_ord))
    await db.flush()
    await _link_note_tags(db, user, note.id, list(tags or []))
    return note


async def _note_or_404(db: AsyncSession, user: CurrentUser, note_id: int) -> SrsNote:
    note = await db.get(SrsNote, note_id)
    if note is None or note.deleted_at is not None:
        raise _404("Not bulunamadı")
    await _note_deck_or_404(db, user, note.deck_id)
    return note


async def _sync_cloze_cards(db: AsyncSession, note: SrsNote) -> None:
    """T-4: kalkan N'in kartı VE progress'i soft-delete; geri gelen N'de kart
    ve progress GERİ CANLANIR; yeni N için yeni (NEW) kart doğar."""
    now = _now()
    target = set(_cloze_ords(note.front))
    cards = (
        await db.execute(select(SrsCard).where(SrsCard.note_id == note.id))
    ).scalars().all()
    by_ord = {c.template_ord: c for c in cards}
    for card in cards:
        if card.template_ord not in target and card.deleted_at is None:
            card.deleted_at = now
            await db.execute(
                update(SrsProgress)
                .where(SrsProgress.card_id == card.id, SrsProgress.deleted_at.is_(None))
                .values(deleted_at=now)
                .execution_options(synchronize_session=False)
            )
    for template_ord in target:
        card = by_ord.get(template_ord)
        if card is None:
            db.add(
                SrsCard(
                    note_id=note.id, deck_id=note.deck_id, template_ord=template_ord
                )
            )
        elif card.deleted_at is not None:
            card.deleted_at = None
            await db.execute(
                update(SrsProgress)
                .where(
                    SrsProgress.card_id == card.id, SrsProgress.deleted_at.isnot(None)
                )
                .values(deleted_at=None)
                .execution_options(synchronize_session=False)
            )
    await db.flush()


async def update_note(
    db: AsyncSession, user: CurrentUser, note_id: int, changes: dict
) -> SrsNote:
    note = await _note_or_404(db, user, note_id)
    front_changed = "front" in changes and changes["front"] is not None
    if front_changed:
        if not str(changes["front"]).strip():
            raise _422("Ön yüz boş olamaz")
        note.front = changes["front"]
    if "back" in changes and changes["back"] is not None:
        note.back = changes["back"]
    if note.note_type == "CLOZE" and front_changed:
        await _sync_cloze_cards(db, note)
    if "tags" in changes and changes["tags"] is not None:
        new_names = [t.strip() for t in changes["tags"] if t and t.strip()]
        # Tam-değişim: eski bağlardan yeni kümede olmayanlar kalkar.
        current = (
            await db.execute(
                select(SrsNoteTag, SrsTag)
                .join(SrsTag, SrsTag.id == SrsNoteTag.tag_id)
                .where(SrsNoteTag.note_id == note.id)
            )
        ).all()
        keep = {n.lower() for n in new_names}
        for link, tag in current:
            if tag.name.lower() not in keep:
                await db.execute(
                    delete(SrsNoteTag).where(SrsNoteTag.id == link.id)
                )
        await _link_note_tags(db, user, note.id, new_names)
    await db.flush()
    return note


async def delete_note(db: AsyncSession, user: CurrentUser, note_id: int) -> None:
    note = await _note_or_404(db, user, note_id)
    now = _now()
    note.deleted_at = now
    await db.execute(
        update(SrsCard)
        .where(SrsCard.note_id == note.id, SrsCard.deleted_at.is_(None))
        .values(deleted_at=now)
        .execution_options(synchronize_session=False)
    )
    await db.flush()


# ── Etiketler ────────────────────────────────────────────────────────────────


async def list_tags(db: AsyncSession, user: CurrentUser) -> list[SrsTag]:
    return list(
        (
            await db.execute(
                select(SrsTag)
                .where(
                    SrsTag.owner_user_id == user.id,
                    SrsTag.owner_role_id == user.role_id,
                    SrsTag.deleted_at.is_(None),
                )
                .order_by(SrsTag.name)
            )
        ).scalars().all()
    )


async def _tags_by_note(
    db: AsyncSession, note_ids: list[int]
) -> dict[int, list[str]]:
    if not note_ids:
        return {}
    rows = await db.execute(
        select(SrsNoteTag.note_id, SrsTag.name)
        .join(SrsTag, SrsTag.id == SrsNoteTag.tag_id)
        .where(SrsNoteTag.note_id.in_(note_ids), SrsTag.deleted_at.is_(None))
        .order_by(SrsTag.name)
    )
    out: dict[int, list[str]] = {}
    for note_id, name in rows.all():
        out.setdefault(note_id, []).append(name)
    return out


# ── Kart tarayıcı (B matrisi: sunucu sayfalama) ──────────────────────────────


async def browse_cards(
    db: AsyncSession,
    user: CurrentUser,
    *,
    deck_id: int | None = None,
    state: str | None = None,
    tag: str | None = None,
    q: str | None = None,
    suspended: bool | None = None,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[dict], int, int, int]:
    """Sunucu sayfalı kart listesi + kapsam sayaçları (kalem, toplam, askıda, leech).

    Sunucu sayfalı kart listesi. `state`/`due_at`/`suspended` İSTEYENİN
    KENDİ progress'idir; satırı olmayan kart NEW görünür (K-6: başkasının
    ilerlemesi hiçbir satıra girmez)."""
    if state is not None and state not in PROGRESS_STATES:
        raise _422("Geçersiz durum filtresi")
    if page < 1 or page_size < 1 or page_size > _MAX_PAGE_SIZE:
        raise _422("Geçersiz sayfalama")
    if deck_id is not None:
        deck = await _visible_deck_or_404(db, user, deck_id)
        scope_ids = await _subtree_ids(db, deck)
    else:
        rows = await db.execute(
            select(SrsDeck.id).where(
                SrsDeck.owner_user_id == user.id,
                SrsDeck.owner_role_id == user.role_id,
                SrsDeck.deleted_at.is_(None),
            )
        )
        scope_ids = [r[0] for r in rows]
        if not scope_ids:
            return [], 0, 0, 0

    prog = aliased(SrsProgress)
    conds = [
        SrsCard.deleted_at.is_(None),
        SrsNote.deleted_at.is_(None),
        SrsCard.deck_id.in_(scope_ids),
    ]
    if state == "NEW":
        conds.append(or_(prog.id.is_(None), prog.state == "NEW"))
    elif state is not None:
        conds.append(prog.state == state)
    if q:
        pattern = f"%{q}%"
        conds.append(or_(SrsNote.front.ilike(pattern), SrsNote.back.ilike(pattern)))
    if suspended is True:
        conds.append(prog.suspended_at.isnot(None))
    elif suspended is False:
        conds.append(or_(prog.id.is_(None), prog.suspended_at.is_(None)))
    if tag:
        conds.append(
            select(SrsNoteTag.id)
            .join(SrsTag, SrsTag.id == SrsNoteTag.tag_id)
            .where(
                SrsNoteTag.note_id == SrsNote.id,
                func.lower(SrsTag.name) == tag.strip().lower(),
                SrsTag.deleted_at.is_(None),
            )
            .exists()
        )

    own_join = and_(
        prog.card_id == SrsCard.id,
        prog.user_id == user.id,
        prog.role_id == user.role_id,
        prog.deleted_at.is_(None),
    )
    total = (
        await db.execute(
            select(func.count())
            .select_from(SrsCard)
            .join(SrsNote, SrsNote.id == SrsCard.note_id)
            .outerjoin(prog, own_join)
            .where(*conds)
        )
    ).scalar_one()
    rows = await db.execute(
        select(SrsCard, SrsNote, prog)
        .join(SrsNote, SrsNote.id == SrsCard.note_id)
        .outerjoin(prog, own_join)
        .where(*conds)
        .order_by(SrsCard.id)  # deterministik (B-3)
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    entries = rows.all()
    tag_map = await _tags_by_note(db, [n.id for _c, n, _p in entries])
    items = []
    for card, note, p in entries:
        front, back = _card_faces(note, card.template_ord)
        items.append(
            {
                "id": card.id,
                "note_id": note.id,
                "deck_id": card.deck_id,
                "template_ord": card.template_ord,
                "note_type": note.note_type,
                "front": front,
                "back": back,
                "tags": tag_map.get(note.id, []),
                "state": p.state if p is not None else "NEW",
                "due_at": p.due_at if p is not None else None,
                "suspended": bool(p is not None and p.suspended_at is not None),
                "is_leech": bool(p is not None and p.is_leech),
            }
        )
    # Kapsam sayaçları: filtrelerden bağımsız, YALNIZ isteyenin kendi satırları.
    sayac = (
        await db.execute(
            select(
                func.count().filter(SrsProgress.suspended_at.isnot(None)),
                func.count().filter(SrsProgress.is_leech.is_(True)),
            )
            .select_from(SrsProgress)
            .join(SrsCard, SrsCard.id == SrsProgress.card_id)
            .where(
                SrsProgress.user_id == user.id,
                SrsProgress.role_id == user.role_id,
                SrsProgress.deleted_at.is_(None),
                SrsCard.deleted_at.is_(None),
                SrsCard.deck_id.in_(scope_ids),
            )
        )
    ).one()
    return items, int(total), int(sayac[0]), int(sayac[1])


# ── Toplu işlemler ───────────────────────────────────────────────────────────

_PROGRESS_ACTIONS = {"suspend", "unsuspend", "bury", "unbury"}
_CONTENT_ACTIONS = {"move_deck", "add_tag", "remove_tag"}


async def _ensure_progress_rows(
    db: AsyncSession, user: CurrentUser, card_ids: list[int]
) -> dict[int, SrsProgress]:
    rows = (
        await db.execute(
            select(SrsProgress).where(
                SrsProgress.card_id.in_(card_ids),
                SrsProgress.user_id == user.id,
                SrsProgress.role_id == user.role_id,
            )
        )
    ).scalars().all()
    by_card = {p.card_id: p for p in rows}
    for cid in card_ids:
        if cid not in by_card:
            p = SrsProgress(
                card_id=cid, user_id=user.id, role_id=user.role_id, state="NEW"
            )
            db.add(p)
            by_card[cid] = p
    await db.flush()
    return by_card


async def bulk_action(
    db: AsyncSession,
    user: CurrentUser,
    ids: list[int],
    action: str,
    *,
    target_deck_id: int | None = None,
    tag: str | None = None,
) -> dict:
    if action not in _PROGRESS_ACTIONS | _CONTENT_ACTIONS:
        raise _422("Geçersiz toplu işlem")
    card_ids = sorted(set(ids))
    if not card_ids:
        return {"affected": 0}
    cards = (
        await db.execute(
            select(SrsCard).where(
                SrsCard.id.in_(card_ids), SrsCard.deleted_at.is_(None)
            )
        )
    ).scalars().all()
    if len(cards) != len(card_ids):
        raise _404("Kart bulunamadı")
    # Erişim: progress işlemleri görünür destede (atanan öğrenci kendi
    # ilerlemesini yönetir); içerik işlemleri deste SAHİBİNE aittir.
    checked: dict[int, SrsDeck] = {}
    for card in cards:
        if card.deck_id in checked:
            continue
        if action in _PROGRESS_ACTIONS:
            checked[card.deck_id] = await _study_deck_or_404(db, user, card.deck_id)
        else:
            checked[card.deck_id] = await _note_deck_or_404(db, user, card.deck_id)

    now = _now()
    if action in {"suspend", "bury"}:
        by_card = await _ensure_progress_rows(db, user, card_ids)
        for p in by_card.values():
            if action == "suspend":
                p.suspended_at = now
            else:
                p.buried_until = dayboundary.next_day_start(now)
    elif action in {"unsuspend", "unbury"}:
        values = {"suspended_at": None} if action == "unsuspend" else {"buried_until": None}
        await db.execute(
            update(SrsProgress)
            .where(
                SrsProgress.card_id.in_(card_ids),
                SrsProgress.user_id == user.id,
                SrsProgress.role_id == user.role_id,
            )
            .values(**values)
            .execution_options(synchronize_session=False)
        )
    elif action == "move_deck":
        if target_deck_id is None:
            raise _422("target_deck_id gerekli")
        target = await _note_deck_or_404(db, user, target_deck_id)
        for card in cards:
            card.deck_id = target.id
    elif action == "add_tag":
        if not tag or not tag.strip():
            raise _422("tag gerekli")
        note_ids = sorted({c.note_id for c in cards})
        for note_id in note_ids:
            await _link_note_tags(db, user, note_id, [tag])
    elif action == "remove_tag":
        if not tag or not tag.strip():
            raise _422("tag gerekli")
        note_ids = sorted({c.note_id for c in cards})
        tag_row = (
            await db.execute(
                select(SrsTag).where(
                    SrsTag.owner_user_id == user.id,
                    SrsTag.owner_role_id == user.role_id,
                    func.lower(SrsTag.name) == tag.strip().lower(),
                    SrsTag.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if tag_row is not None:
            await db.execute(
                delete(SrsNoteTag).where(
                    SrsNoteTag.note_id.in_(note_ids),
                    SrsNoteTag.tag_id == tag_row.id,
                )
            )
    await db.flush()
    return {"affected": len(card_ids)}


# ── Kuyruk (Q/L/G matrisi) ───────────────────────────────────────────────────


def _own_progress_on(prog, user: CurrentUser):
    return and_(
        prog.card_id == SrsCard.id,
        prog.user_id == user.id,
        prog.role_id == user.role_id,
        prog.deleted_at.is_(None),
    )


def _available(prog, now: datetime.datetime):
    """Askıda/gömülü olmayan (yoksa serbest) kartlar (Q-6/Q-7)."""
    return or_(
        prog.id.is_(None),
        and_(
            prog.suspended_at.is_(None),
            or_(prog.buried_until.is_(None), prog.buried_until <= now),
        ),
    )


async def _count_cards(
    db: AsyncSession,
    user: CurrentUser,
    subtree: list[int],
    now: datetime.datetime,
    cond_fn,
) -> int:
    prog = aliased(SrsProgress)
    stmt = (
        select(func.count())
        .select_from(SrsCard)
        .join(SrsNote, SrsNote.id == SrsCard.note_id)
        .outerjoin(prog, _own_progress_on(prog, user))
        .where(
            SrsCard.deleted_at.is_(None),
            SrsNote.deleted_at.is_(None),
            SrsCard.deck_id.in_(subtree),
            _available(prog, now),
            cond_fn(prog),
        )
    )
    return int((await db.execute(stmt)).scalar_one())


async def _son_cevaplanan_not(
    db: AsyncSession, user: CurrentUser
) -> int | None:
    """Kullanıcının EN SON cevapladığı kartın not kimliği (geri alınmamış log).

    Q-10 kardeş ayırmasının çapası. Tek satırlık bir sorgu: sıralamaya
    girdiği için kuyruk çağrısı başına bir kez okunur.
    """
    stmt = (
        select(SrsCard.note_id)
        .select_from(SrsReviewLog)
        .join(SrsProgress, SrsProgress.id == SrsReviewLog.progress_id)
        .join(SrsCard, SrsCard.id == SrsProgress.card_id)
        .where(
            SrsReviewLog.user_id == user.id,
            SrsReviewLog.role_id == user.role_id,
            SrsReviewLog.undone_at.is_(None),
        )
        .order_by(SrsReviewLog.id.desc())
        .limit(1)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


def _kardes_ayirma(son_note_id: int | None):
    """Q-10: son cevaplanan notun kardeşleri sıranın SONUNA düşer.

    Sözleşme §4.1 "sibling bury YOK" der — kardeşler aynı GÜN gelebilir; bu
    kural onu değiştirmez, yalnız peş peşe gelmelerini engeller. Peş peşe
    gelen ters kart (`BASIC_REVERSED`) ya da aynı metnin cloze'u, öğrenciye
    kartın öğrettiğini değil üç saniye önceki ekranı hatırlatır; ölçülen
    hatırlama değeri bozulur.

    Başka aday yoksa kardeş yine gelir (kuyruğu boşaltmak daha kötü olurdu).
    """
    if son_note_id is None:
        return []
    return [(SrsNote.id == son_note_id).asc()]


async def _pick_card(
    db: AsyncSession,
    user: CurrentUser,
    subtree: list[int],
    now: datetime.datetime,
    cond_fn,
    order_fn,
    son_note_id: int | None = None,
):
    prog = aliased(SrsProgress)
    stmt = (
        select(SrsCard, SrsNote, prog)
        .join(SrsNote, SrsNote.id == SrsCard.note_id)
        .outerjoin(prog, _own_progress_on(prog, user))
        .where(
            SrsCard.deleted_at.is_(None),
            SrsNote.deleted_at.is_(None),
            SrsCard.deck_id.in_(subtree),
            _available(prog, now),
            cond_fn(prog),
        )
        .order_by(*_kardes_ayirma(son_note_id), *order_fn(prog))
        .limit(1)
    )
    return (await db.execute(stmt)).first()


async def _daily_counts(
    db: AsyncSession,
    user: CurrentUser,
    subtree: list[int],
    study_day: datetime.date,
) -> tuple[int, int]:
    """Bugün tanıtılan yeni kart sayısı + bugünkü review-limit dolduran cevap
    sayısı (prev_state ∈ {REVIEW, RELEARNING}; öğrenme adımları sayılmaz)."""
    base = (
        select(func.count())
        .select_from(SrsReviewLog)
        .join(SrsProgress, SrsProgress.id == SrsReviewLog.progress_id)
        .join(SrsCard, SrsCard.id == SrsProgress.card_id)
        .where(
            SrsReviewLog.user_id == user.id,
            SrsReviewLog.role_id == user.role_id,
            SrsReviewLog.study_day == study_day,
            SrsReviewLog.undone_at.is_(None),
            SrsCard.deck_id.in_(subtree),
        )
    )
    introduced = (
        await db.execute(base.where(SrsReviewLog.introduced_new.is_(True)))
    ).scalar_one()
    reviews = (
        await db.execute(
            base.where(SrsReviewLog.prev_state.in_(("REVIEW", "RELEARNING")))
        )
    ).scalar_one()
    return int(introduced), int(reviews)


async def _queue_state(
    db: AsyncSession, user: CurrentUser, deck: SrsDeck, now: datetime.datetime
) -> tuple[dict, int, int, list[int]]:
    subtree = await _subtree_ids(db, deck)
    chain = await deck_chain(db, deck)
    new_limit, review_limit = _effective_limits(chain)
    study_day = dayboundary.study_day(now)
    introduced_today, reviews_today = await _daily_counts(db, user, subtree, study_day)
    rem_new = max(0, new_limit - introduced_today)
    rem_review = max(0, review_limit - reviews_today)
    ahead = now + datetime.timedelta(minutes=LEARN_AHEAD_MINUTES)

    def _new_cond(p):
        return or_(p.id.is_(None), p.state == "NEW")

    def _learning_soon(p):
        return and_(p.state.in_(("LEARNING", "RELEARNING")), p.due_at <= ahead)

    def _review_due(p):
        return and_(p.state == "REVIEW", p.due_at <= now)

    counts = {
        "new": min(await _count_cards(db, user, subtree, now, _new_cond), rem_new),
        "learning": await _count_cards(db, user, subtree, now, _learning_soon),
        "review": min(
            await _count_cards(db, user, subtree, now, _review_due), rem_review
        ),
    }
    return counts, rem_new, rem_review, subtree


def _card_payload(
    card: SrsCard,
    note: SrsNote,
    progress: SrsProgress | None,
    now: datetime.datetime,
) -> dict:
    front, back = _card_faces(note, card.template_ord)
    previews = engine.preview_intervals(
        _engine_state(progress), elapsed_days=_gecen_calisma_gunu(progress, now)
    )
    return {
        "id": card.id,
        "note_id": note.id,
        "deck_id": card.deck_id,
        "note_type": note.note_type,
        "template_ord": card.template_ord,
        "front": front,
        "back": back,
        "state": progress.state if progress is not None else "NEW",
        "due_at": progress.due_at if progress is not None else None,
        "previews": {str(k): int(round(v)) for k, v in previews.items()},
    }


async def study_queue(db: AsyncSession, user: CurrentUser, deck_id: int) -> dict:
    """Sayaçlar + sıradaki kart (sözleşme §4.1 sırası, Q-9 deterministik).

    Limit dolunca kuyruk BOŞ döner, hata değil (L-4)."""
    deck = await _study_deck_or_404(db, user, deck_id)
    now = _now()
    counts, rem_new, rem_review, subtree = await _queue_state(db, user, deck, now)
    ahead = now + datetime.timedelta(minutes=LEARN_AHEAD_MINUTES)

    def _order_due(p):
        return (p.due_at.asc(), SrsCard.id.asc())

    def _order_id(_p):
        return (SrsCard.id.asc(),)

    # Q-10: son cevaplanan notun kardeşi, başka aday varken sıraya girmez.
    son_note = await _son_cevaplanan_not(db, user)

    row = await _pick_card(
        db,
        user,
        subtree,
        now,
        lambda p: and_(p.state.in_(("LEARNING", "RELEARNING")), p.due_at <= now),
        _order_due,
        son_note,
    )
    if row is None and rem_review > 0:
        row = await _pick_card(
            db,
            user,
            subtree,
            now,
            lambda p: and_(p.state == "REVIEW", p.due_at <= now),
            _order_due,
            son_note,
        )
    if row is None and rem_new > 0:
        row = await _pick_card(
            db,
            user,
            subtree,
            now,
            lambda p: or_(p.id.is_(None), p.state == "NEW"),
            _order_id,
            son_note,
        )
    if row is None:
        # Learn-ahead (Anki 20 dk): başka iş yoksa yaklaşan öğrenme kartı.
        row = await _pick_card(
            db,
            user,
            subtree,
            now,
            lambda p: and_(p.state.in_(("LEARNING", "RELEARNING")), p.due_at <= ahead),
            _order_due,
            son_note,
        )
    card_dict = None
    if row is not None:
        card, note, progress = row
        card_dict = _card_payload(card, note, progress, now)
    return {"counts": counts, "card": card_dict}


# ── Cevap (S-1/S-2 idempotent claim) ─────────────────────────────────────────


def _leech_triggered(lapses: int) -> bool:
    threshold = int(getattr(params, "LEECH_THRESHOLD", 8))
    half = max(1, threshold // 2)
    return lapses == threshold or (lapses > threshold and (lapses - threshold) % half == 0)


async def _locked_progress(
    db: AsyncSession, user: CurrentUser, card_id: int
) -> SrsProgress:
    """Progress satırını FOR UPDATE ile alır; yoksa idempotent oluşturur.

    Eşzamanlı iki istek aynı NEW kart için yarışırsa unique(card, user, role)
    üzerinden serileşir: `ON CONFLICT DO NOTHING` kazananı bekler, sonra
    ikinci SELECT kilidi devralır.
    """
    stmt = (
        select(SrsProgress)
        .where(
            SrsProgress.card_id == card_id,
            SrsProgress.user_id == user.id,
            SrsProgress.role_id == user.role_id,
        )
        .with_for_update()
    )
    progress = (await db.execute(stmt)).scalar_one_or_none()
    if progress is None:
        await db.execute(
            pg_insert(SrsProgress)
            .values(
                card_id=card_id, user_id=user.id, role_id=user.role_id, state="NEW"
            )
            .on_conflict_do_nothing(index_elements=["card_id", "user_id", "role_id"])
        )
        progress = (await db.execute(stmt)).scalar_one()
    return progress


async def answer(
    db: AsyncSession,
    user: CurrentUser,
    card_id: int,
    rating: int,
    client_token: str | uuid_mod.UUID | None,
) -> dict:
    if user.role_id == ROLE_ADMIN:
        raise _404("Kart bulunamadı")
    if rating not in (1, 2, 3, 4):
        raise _422("Geçersiz cevap (1-4)")
    token: uuid_mod.UUID | None = None
    if client_token is not None:
        try:
            token = (
                client_token
                if isinstance(client_token, uuid_mod.UUID)
                else uuid_mod.UUID(str(client_token))
            )
        except ValueError as exc:
            raise _422("Geçersiz client_token") from exc

    card = await db.get(SrsCard, card_id)
    if card is None or card.deleted_at is not None:
        raise _404("Kart bulunamadı")
    note = await db.get(SrsNote, card.note_id)
    if note is None or note.deleted_at is not None:
        raise _404("Kart bulunamadı")
    deck = await _visible_deck_or_404(db, user, card.deck_id)

    now = _now()
    progress = await _locked_progress(db, user, card_id)

    introduced = progress.state == "NEW"
    log_values = {
        "progress_id": progress.id,
        "user_id": user.id,
        "role_id": user.role_id,
        "rating": rating,
        "reviewed_at": now,
        "study_day": dayboundary.study_day(now),
        "client_token": token,
        "introduced_new": introduced,
        "prev_state": progress.state,
        "prev_step": progress.step,
        "prev_stability": progress.stability,
        "prev_difficulty": progress.difficulty,
        "prev_due_at": progress.due_at,
        "prev_last_review_at": progress.last_review_at,
        "prev_reps": progress.reps,
        "prev_lapses": progress.lapses,
        "prev_is_leech": progress.is_leech,
        "prev_suspended_at": progress.suspended_at,
    }
    stmt = pg_insert(SrsReviewLog).values(**log_values)
    if token is not None:
        stmt = stmt.on_conflict_do_nothing(
            index_elements=["user_id", "role_id", "client_token"],
            index_where=SrsReviewLog.client_token.isnot(None),
        )
    result = await db.execute(stmt)
    if token is not None and result.rowcount == 0:
        # Claim düştü: bu cevap DAHA ÖNCE işlendi (S-1). İlerleme İKİNCİ KEZ
        # yazılmaz; mevcut durum ve taze sayaçlar döner.
        earlier = (
            await db.execute(
                select(SrsReviewLog.introduced_new).where(
                    SrsReviewLog.user_id == user.id,
                    SrsReviewLog.role_id == user.role_id,
                    SrsReviewLog.client_token == token,
                )
            )
        ).scalar_one_or_none()
        counts, _rn, _rr, _st = await _queue_state(db, user, deck, now)
        return {
            "card_id": card_id,
            "state": progress.state,
            "step": progress.step,
            "due_at": progress.due_at,
            "introduced_new": bool(earlier),
            "counts": counts,
        }

    prev_lapses = progress.lapses
    outcome = engine.review(
        _engine_state(progress),
        rating,
        elapsed_days=_gecen_calisma_gunu(progress, now),
    )
    new_state = outcome.state
    progress.state = _phase_value(new_state.phase)
    progress.step = new_state.step
    progress.stability = new_state.stability
    progress.difficulty = new_state.difficulty
    # Vade damgası burada konur: motor takvim bilmez (H3). Gün ölçekli aralık
    # hedef ÇALIŞMA GÜNÜNÜN BAŞINA yuvarlanır (İP-17, sözleşme §4.3/G-5);
    # intraday öğrenme adımları dakika ölçeğinde kalır.
    #
    # NEDEN ayrım `state` ile, `interval_minutes >= 1440` ile DEĞİL: ikisi
    # bugün aynı kümeyi seçiyor (ölçüldü — çıkış fazı REVIEW ⟺ aralık tam
    # gün × 1440; `_next_interval_days` sonucu [1, MAXIMUM_INTERVAL_DAYS]'e
    # clamp'li, öğrenme adımları ise (1, 10) ve (10,) dakika, asla ≥1440
    # olamaz). Ama bu eşdeğerlik bir RASTLANTI, sözleşme değil: öğrenme
    # adımları deste ayarından gelseydi (Anki'de gelir) "3 gün"lük bir
    # learning adımı mümkün olurdu ve sayısal eşik onu sessizce yuvarlardı.
    # Faz, kartın hangi ölçekte yaşadığını söyler; dakika sayısı yalnız o
    # ölçeğin bugünkü değerini. `LEARNING_STEPS_MINUTES` değişince faza
    # bağlı ayrım kırılmaz, eşiğe bağlı ayrım sessizce yanlışlanır.
    if progress.state == "REVIEW":
        gun = int(round(outcome.interval_minutes / 1440))
        progress.due_at = dayboundary.day_start(
            dayboundary.study_day(now) + datetime.timedelta(days=gun)
        )
    else:
        progress.due_at = now + datetime.timedelta(
            minutes=outcome.interval_minutes
        )
    progress.last_review_at = now
    progress.reps = int(getattr(new_state, "reps", progress.reps + 1))
    progress.lapses = int(getattr(new_state, "lapses", progress.lapses))
    # Leech (Q-8): yeni lapse eşiğe değdiyse işaretle + otomatik askıya al.
    if progress.lapses > prev_lapses and _leech_triggered(progress.lapses):
        progress.is_leech = True
        progress.suspended_at = now
    await db.flush()

    counts, _rn, _rr, _st = await _queue_state(db, user, deck, now)
    return {
        "card_id": card_id,
        "state": progress.state,
        "step": progress.step,
        "due_at": progress.due_at,
        "introduced_new": introduced,
        "counts": counts,
    }


# ── Undo (S-4/S-5: koşullu claim, zincir yok) ────────────────────────────────


async def undo(db: AsyncSession, user: CurrentUser) -> dict:
    now = _now()
    last_id = (
        select(func.max(SrsReviewLog.id))
        .where(SrsReviewLog.user_id == user.id, SrsReviewLog.role_id == user.role_id)
        .scalar_subquery()
    )
    # escrow.claim deseni: yalnız EN SON ve henüz geri alınmamış log damgalanır.
    # En son log zaten undone ise koşul düşer → 409 (zincirleme undo yok, S-5).
    result = await db.execute(
        update(SrsReviewLog)
        .where(SrsReviewLog.id == last_id, SrsReviewLog.undone_at.is_(None))
        .values(undone_at=now)
        .returning(SrsReviewLog.id)
        .execution_options(synchronize_session=False)
    )
    row = result.first()
    if row is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Geri alınacak cevap yok"
        )
    log = await db.get(SrsReviewLog, row[0])
    progress = (
        await db.execute(
            select(SrsProgress)
            .where(SrsProgress.id == log.progress_id)
            .with_for_update()
        )
    ).scalar_one()
    progress.state = log.prev_state or "NEW"
    progress.step = log.prev_step
    progress.stability = log.prev_stability
    progress.difficulty = log.prev_difficulty
    progress.due_at = log.prev_due_at
    progress.last_review_at = log.prev_last_review_at
    progress.reps = log.prev_reps
    progress.lapses = log.prev_lapses
    progress.is_leech = log.prev_is_leech
    progress.suspended_at = log.prev_suspended_at
    await db.flush()
    return {"card_id": progress.card_id, "state": progress.state}


# ── İstatistik (I matrisi; K-6: yalnız kendi verisi) ─────────────────────────


async def stats(
    db: AsyncSession, user: CurrentUser, deck_id: int | None = None
) -> dict:
    subtree: list[int] | None = None
    if deck_id is not None:
        deck = await _visible_deck_or_404(db, user, deck_id)
        subtree = await _subtree_ids(db, deck)

    log_q = (
        select(SrsReviewLog.rating)
        .select_from(SrsReviewLog)
        .where(
            SrsReviewLog.user_id == user.id,
            SrsReviewLog.role_id == user.role_id,
            SrsReviewLog.undone_at.is_(None),
            SrsReviewLog.prev_state.in_(("REVIEW", "RELEARNING")),
        )
    )
    if subtree is not None:
        log_q = (
            log_q.join(SrsProgress, SrsProgress.id == SrsReviewLog.progress_id)
            .join(SrsCard, SrsCard.id == SrsProgress.card_id)
            .where(SrsCard.deck_id.in_(subtree))
        )
    ratings = [r[0] for r in (await db.execute(log_q)).all()]
    review_count = len(ratings)
    retention_rate = (
        None
        if review_count == 0
        else sum(1 for r in ratings if r >= 2) / review_count
    )

    now = _now()
    load_q = (
        select(SrsProgress.due_at)
        .select_from(SrsProgress)
        .where(
            SrsProgress.user_id == user.id,
            SrsProgress.role_id == user.role_id,
            SrsProgress.deleted_at.is_(None),
            SrsProgress.suspended_at.is_(None),
            SrsProgress.state.in_(("LEARNING", "REVIEW", "RELEARNING")),
            SrsProgress.due_at.isnot(None),
            SrsProgress.due_at > now,
            SrsProgress.due_at <= now + datetime.timedelta(days=30),
        )
    )
    if subtree is not None:
        load_q = load_q.join(SrsCard, SrsCard.id == SrsProgress.card_id).where(
            SrsCard.deck_id.in_(subtree)
        )
    per_day: dict[str, int] = {}
    for (due_at,) in (await db.execute(load_q)).all():
        day = dayboundary.study_day(due_at).isoformat()
        per_day[day] = per_day.get(day, 0) + 1
    future_load = [{"day": d, "due": n} for d, n in sorted(per_day.items())]

    state_q = (
        select(SrsProgress.state, func.count())
        .select_from(SrsProgress)
        .where(
            SrsProgress.user_id == user.id,
            SrsProgress.role_id == user.role_id,
            SrsProgress.deleted_at.is_(None),
        )
        .group_by(SrsProgress.state)
    )
    if subtree is not None:
        state_q = state_q.join(SrsCard, SrsCard.id == SrsProgress.card_id).where(
            SrsCard.deck_id.in_(subtree)
        )
    counts = {s: 0 for s in PROGRESS_STATES}
    for state_name, n in (await db.execute(state_q)).all():
        counts[state_name] = int(n)
    return {
        "review_count": review_count,
        "retention_rate": retention_rate,
        "future_load": future_load,
        "counts": counts,
    }


# ── Platform desteleri (ADMIN; izinler router'da: srs_platform.*) ────────────


async def create_platform_deck(
    db: AsyncSession,
    admin: CurrentUser,
    *,
    name: str,
    description: str | None = None,
    parent_id: int | None = None,
    new_per_day: int | None = None,
    reviews_per_day: int | None = None,
) -> SrsDeck:
    return await create_deck(
        db,
        admin,
        name=name,
        description=description,
        parent_id=parent_id,
        new_per_day=new_per_day,
        reviews_per_day=reviews_per_day,
        visibility="PLATFORM",
    )


async def list_platform_decks_admin(db: AsyncSession) -> list[SrsDeck]:
    return await list_platform_decks(db)


async def _platform_deck_or_404(db: AsyncSession, deck_id: int) -> SrsDeck:
    deck = await _get_live_deck(db, deck_id)
    if deck is None or deck.visibility != "PLATFORM":
        raise _404("Deste bulunamadı")
    return deck


async def update_platform_deck(
    db: AsyncSession, admin: CurrentUser, deck_id: int, changes: dict
) -> SrsDeck:
    deck = await _platform_deck_or_404(db, deck_id)
    _apply_deck_changes(deck, changes)
    await db.flush()
    return deck


async def delete_platform_deck(
    db: AsyncSession, admin: CurrentUser, deck_id: int
) -> None:
    deck = await _platform_deck_or_404(db, deck_id)
    await _soft_delete_subtree(db, deck)
    await db.flush()


async def create_platform_note(
    db: AsyncSession,
    admin: CurrentUser,
    deck_id: int,
    *,
    note_type: str,
    front: str,
    back: str,
    tags: list[str] | None = None,
) -> SrsNote:
    await _platform_deck_or_404(db, deck_id)
    return await create_note(
        db,
        admin,
        deck_id,
        note_type=note_type,
        front=front,
        back=back,
        tags=tags,
    )
