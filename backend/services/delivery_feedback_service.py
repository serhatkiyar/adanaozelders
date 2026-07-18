"""Teslim sonrası müşteri değerlendirmesi (Faz 7 — 👍/👎 + yapısal sorun).

Kurallar:
- Yalnız DELIVERED sipariş değerlendirilir (teslim edilmemiş şeye puan yok).
- Sipariş başına TEK değerlendirme; tekrar → 409 (yarışta partial unique index
  son sözü söyler, IntegrityError global handler'la 409'a çevrilir).
- Hem oturumlu müşteri (sahiplik kontrollü) hem token'lı public takip sayfası
  verebilir — durum değiştirmeyen geri bildirimdir, yetki yükseltme değildir;
  ``source`` hangi yüzeyden geldiğini kaydeder.
- 👎'de en az bir yapısal sorun kodu zorunlu — Pareto'suz şikâyet aksiyonsuzdur.
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.delivery import DeliveryFeedback
from models.store import Order
from schemas.delivery import DeliveryFeedbackIn, DeliveryFeedbackOut


def _to_out(fb: DeliveryFeedback) -> DeliveryFeedbackOut:
    return DeliveryFeedbackOut(
        id=fb.id,
        order_id=fb.order_id,
        thumbs_up=fb.thumbs_up,
        problem_codes=list(fb.problem_codes or []),
        comment=fb.comment,
        source=fb.source,
        created_at=fb.created_at,
    )


async def get_for_order(
    db: AsyncSession, order_id: int
) -> DeliveryFeedback | None:
    return (
        await db.execute(
            select(DeliveryFeedback).where(
                DeliveryFeedback.order_id == order_id,
                DeliveryFeedback.deleted_at.is_(None),
            )
        )
    ).scalars().first()


async def get_feedback_out(
    db: AsyncSession, order_id: int
) -> DeliveryFeedbackOut | None:
    fb = await get_for_order(db, order_id)
    return _to_out(fb) if fb is not None else None


async def create_feedback(
    db: AsyncSession,
    order: Order,
    payload: DeliveryFeedbackIn,
    *,
    source: str,
) -> DeliveryFeedbackOut:
    if order.status != "DELIVERED":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Değerlendirme yalnız teslim edilmiş sipariş için yapılabilir",
        )
    if not payload.thumbs_up and not payload.problem_codes:
        # 422 literal: Starlette sürümleri arasında sabit adı değişti
        # (UNPROCESSABLE_ENTITY→CONTENT) — container/host uyumu için sayı.
        raise HTTPException(422, "Sorun bildirirken en az bir sorun türü seçilmeli")
    if await get_for_order(db, order.id) is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Bu sipariş zaten değerlendirilmiş"
        )
    fb = DeliveryFeedback(
        order_id=order.id,
        thumbs_up=payload.thumbs_up,
        # 👍'de sorun kodu taşınmaz (yanlışlıkla işaretlenmiş chip Pareto'yu kirletmesin).
        problem_codes=payload.problem_codes if not payload.thumbs_up else [],
        comment=(payload.comment or "").strip() or None,
        source=source,
    )
    db.add(fb)
    await db.commit()
    await db.refresh(fb)
    return _to_out(fb)


async def list_recent(
    db: AsyncSession, *, limit: int = 50
) -> list[DeliveryFeedbackOut]:
    """Admin: son değerlendirmeler (yorumları okumak için)."""
    rows = (
        await db.execute(
            select(DeliveryFeedback)
            .where(DeliveryFeedback.deleted_at.is_(None))
            .order_by(DeliveryFeedback.id.desc())
            .limit(limit)
        )
    ).scalars().all()
    return [_to_out(f) for f in rows]


async def kpi_counts(
    db: AsyncSession, since
) -> tuple[int, int, dict[str, int]]:
    """KPI penceresi için (👍, 👎, sorun Pareto'su). Pareto Python'da toplanır —
    JSONB listeyi SQL'de patlatmaya değecek hacim yok (günde ~100 sipariş)."""
    rows = (
        await db.execute(
            select(DeliveryFeedback.thumbs_up, DeliveryFeedback.problem_codes)
            .where(
                DeliveryFeedback.deleted_at.is_(None),
                DeliveryFeedback.created_at >= since,
            )
        )
    ).all()
    up = sum(1 for t, _ in rows if t)
    down = len(rows) - up
    problems: dict[str, int] = {}
    for thumbs, codes in rows:
        if thumbs:
            continue
        for code in codes or []:
            problems[code] = problems.get(code, 0) + 1
    return up, down, problems
