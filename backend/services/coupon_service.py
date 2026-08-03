"""Kupon (indirim kodu) iş mantığı.

``compute_discount`` saf fonksiyondur (pytest'li). ``evaluate`` kuponun geçerliliğini
(aktiflik, pencere, min sepet, global + kullanıcı-başı limit) denetler ve indirimi
döndürür; sipariş **PAID** olunca ``redeem`` kullanımı sayar, iptal/iade'de ``release``
geri salar. Tutar otoritesi sunucudadır.
"""
from __future__ import annotations

import datetime
import logging
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.store import Coupon, CouponDiscountType, CouponRedemption
from schemas.store import CouponCreate, CouponOut, CouponUpdate

logger = logging.getLogger("adana.coupon")

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
) -> bool:
    """Sipariş PAID olunca kullanımı say (used_count++ + redemption satırı).

    Limitler burada, kilit altında YENİDEN doğrulanır. ``evaluate`` sipariş
    *oluşturulurken* çalışır ama redemption satırı ancak ödeme kesinleşince
    yazılır; arada geniş bir pencere vardır. Önceden bu pencerede kullanıcı
    aynı kuponla N sipariş açıp (hiçbiri redemption yazmadığından ``evaluate``
    hepsini geçirir) sonra N'ini de ödeyerek ``max_uses`` ve ``per_user_limit``
    sınırlarını aşabiliyordu.

    Dönüş: kullanım sayıldıysa True. False = limit dolmuş; çağıran indirimi
    geri almalıdır (para yolu bunu ``_finalize_paid`` içinde yapar).
    """
    coupon = (
        await db.execute(select(Coupon).where(Coupon.id == coupon_id).with_for_update())
    ).scalars().first()
    if coupon is None:
        return False

    if coupon.max_uses is not None and coupon.used_count >= coupon.max_uses:
        logger.warning(
            "kupon %s global limitte (%s/%s) — sipariş %s indirimsiz sayılacak",
            coupon.code, coupon.used_count, coupon.max_uses, order_id,
        )
        return False
    if coupon.per_user_limit is not None:
        used = (
            await db.execute(
                select(func.count())
                .select_from(CouponRedemption)
                .where(
                    CouponRedemption.coupon_id == coupon_id,
                    CouponRedemption.client_id == client_id,
                )
            )
        ).scalar() or 0
        if used >= coupon.per_user_limit:
            logger.warning(
                "kupon %s kullanıcı limitinde (client=%s %s/%s) — sipariş %s "
                "indirimsiz sayılacak",
                coupon.code, client_id, used, coupon.per_user_limit, order_id,
            )
            return False

    coupon.used_count += 1
    db.add(
        CouponRedemption(coupon_id=coupon_id, client_id=client_id, order_id=order_id)
    )
    return True


async def release(db: AsyncSession, *, coupon_id: int, order_id: int) -> bool:
    """İptal/iade: kullanımı geri sal (used_count-- + redemption sil).

    **Yalnız BU siparişin gerçekten saydığı kullanım geri açılır.** Sayaç,
    redemption satırının varlığına bağlıdır ve koşulsuz düşürülmez:

    `redeem` kupon limitte olduğunda **False** döner ve hiçbir iz yazmaz — ama
    sipariş `coupon_id` alanını taşımaya devam eder (indirim uygulanmıştı).
    Eski koşulsuz `used_count--`, böyle bir siparişin iptalinde BAŞKA müşterinin
    saydığı kullanımı serbest bırakıyordu: `max_uses=1` kampanya kuponu fiilen
    iki kez kullanılabiliyor, sayaç ile satırlar kalıcı olarak ayrışıyordu.

    Yan fayda — **idempotent**: satır bir kez silindikten sonra ikinci çağrı
    no-op'tur (retry/çift iptal sayacı ikinci kez düşüremez).

    Dönen: kullanım gerçekten geri açıldı mı.
    """
    # Kilit sırası korunur: önce kupon satırı (sayaç otoritesi), sonra redemption.
    coupon = (
        await db.execute(select(Coupon).where(Coupon.id == coupon_id).with_for_update())
    ).scalars().first()
    redemption = (
        await db.execute(
            select(CouponRedemption).where(
                CouponRedemption.coupon_id == coupon_id,
                CouponRedemption.order_id == order_id,
            )
        )
    ).scalars().first()
    if redemption is None:
        logger.info(
            "coupon %s: sipariş %s için redemption satırı yok — sayaç "
            "DÜŞÜRÜLMEDİ (kullanım hiç sayılmamıştı)",
            coupon_id, order_id,
        )
        return False
    if coupon is not None and coupon.used_count > 0:
        coupon.used_count -= 1
    await db.delete(redemption)
    return True


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
