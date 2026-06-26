"""Kupon (indirim kodu) iş mantığı.

``compute_discount`` saf fonksiyondur (pytest'li). ``evaluate`` kuponun geçerliliğini
(aktiflik, pencere, min sepet, global + kullanıcı-başı limit) denetler ve indirimi
döndürür; sipariş **PAID** olunca ``redeem`` kullanımı sayar, iptal/iade'de ``release``
geri salar. Tutar otoritesi sunucudadır.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.store import Coupon, CouponDiscountType, CouponRedemption
from schemas.store import CouponCreate, CouponOut, CouponUpdate

_CENT = Decimal("0.01")


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def compute_discount(
    subtotal: Decimal, discount_type: str, discount_value: Decimal
) -> Decimal:
    """İndirim tutarı (subtotal'ı aşamaz, negatif olamaz) — saf, test edilebilir."""
    if discount_type == CouponDiscountType.PERCENT.value:
        raw = subtotal * discount_value / Decimal("100")
    else:
        raw = discount_value
    capped = min(raw, subtotal)
    if capped < 0:
        capped = Decimal("0")
    return capped.quantize(_CENT)


def _norm(code: str) -> str:
    return code.strip().upper()


async def _by_code(db: AsyncSession, code: str) -> Coupon | None:
    return (
        await db.execute(
            select(Coupon).where(
                func.upper(Coupon.code) == _norm(code),
                Coupon.deleted_at.is_(None),
            )
        )
    ).scalars().first()


async def evaluate(
    db: AsyncSession, *, code: str, subtotal: Decimal, client_id: int
) -> tuple[Coupon, Decimal]:
    """Kupon geçerliyse (coupon, discount) döner; değilse kullanıcı dostu 4xx atar."""
    coupon = await _by_code(db, code)
    if coupon is None or not coupon.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kupon bulunamadı veya geçerli değil")

    now = _now()
    if coupon.valid_from and now < coupon.valid_from:
        raise HTTPException(status.HTTP_409_CONFLICT, "Kupon henüz geçerli değil")
    if coupon.valid_until and now > coupon.valid_until:
        raise HTTPException(status.HTTP_409_CONFLICT, "Kuponun süresi dolmuş")
    if subtotal < Decimal(str(coupon.min_subtotal)):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Bu kupon için minimum sepet tutarı {coupon.min_subtotal} TL",
        )
    if coupon.max_uses is not None and coupon.used_count >= coupon.max_uses:
        raise HTTPException(status.HTTP_409_CONFLICT, "Kupon kullanım limitine ulaşıldı")
    if coupon.per_user_limit is not None:
        used = (
            await db.execute(
                select(func.count())
                .select_from(CouponRedemption)
                .where(
                    CouponRedemption.coupon_id == coupon.id,
                    CouponRedemption.client_id == client_id,
                )
            )
        ).scalar() or 0
        if used >= coupon.per_user_limit:
            raise HTTPException(status.HTTP_409_CONFLICT, "Bu kuponu kullanım hakkın doldu")

    discount = compute_discount(
        subtotal, coupon.discount_type, Decimal(str(coupon.discount_value))
    )
    return coupon, discount


async def redeem(
    db: AsyncSession, *, coupon_id: int, client_id: int, order_id: int
) -> None:
    """Sipariş PAID olunca kullanımı say (used_count++ + redemption satırı)."""
    coupon = (
        await db.execute(select(Coupon).where(Coupon.id == coupon_id).with_for_update())
    ).scalars().first()
    if coupon is not None:
        coupon.used_count += 1
    db.add(
        CouponRedemption(coupon_id=coupon_id, client_id=client_id, order_id=order_id)
    )


async def release(db: AsyncSession, *, coupon_id: int, order_id: int) -> None:
    """İptal/iade: kullanımı geri sal (used_count-- + redemption sil)."""
    coupon = (
        await db.execute(select(Coupon).where(Coupon.id == coupon_id).with_for_update())
    ).scalars().first()
    if coupon is not None and coupon.used_count > 0:
        coupon.used_count -= 1
    redemption = (
        await db.execute(
            select(CouponRedemption).where(
                CouponRedemption.coupon_id == coupon_id,
                CouponRedemption.order_id == order_id,
            )
        )
    ).scalars().first()
    if redemption is not None:
        await db.delete(redemption)


# ── Admin CRUD ──────────────────────────────────────────────────────────────────


async def list_coupons(db: AsyncSession) -> list[CouponOut]:
    rows = (
        await db.execute(
            select(Coupon)
            .where(Coupon.deleted_at.is_(None))
            .order_by(Coupon.created_at.desc())
        )
    ).scalars().all()
    return [CouponOut.model_validate(c) for c in rows]


async def create_coupon(db: AsyncSession, payload: CouponCreate) -> CouponOut:
    existing = await _by_code(db, payload.code)
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu kod zaten kullanımda")
    coupon = Coupon(
        code=_norm(payload.code),
        discount_type=payload.discount_type,
        discount_value=payload.discount_value,
        min_subtotal=payload.min_subtotal,
        max_uses=payload.max_uses,
        per_user_limit=payload.per_user_limit,
        valid_from=payload.valid_from,
        valid_until=payload.valid_until,
        is_active=payload.is_active,
    )
    db.add(coupon)
    await db.commit()
    await db.refresh(coupon)
    return CouponOut.model_validate(coupon)


async def update_coupon(
    db: AsyncSession, coupon_id: int, payload: CouponUpdate
) -> CouponOut:
    coupon = await db.get(Coupon, coupon_id)
    if coupon is None or coupon.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kupon bulunamadı")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(coupon, field, value)
    await db.commit()
    await db.refresh(coupon)
    return CouponOut.model_validate(coupon)


async def delete_coupon(db: AsyncSession, coupon_id: int) -> None:
    coupon = await db.get(Coupon, coupon_id)
    if coupon is None or coupon.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kupon bulunamadı")
    coupon.deleted_at = _now()
    await db.commit()
