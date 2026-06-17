"""Platform komisyonu — oran ve bölüştürme (tek kaynak).

Komisyon = tutar × oran. Oran, tedarikçinin (eğitmen/kütüphane) bitiş tarihli
**promosyon override**'ı aktifse ondan, değilse global ``PLATFORM_COMMISSION_RATE``'ten
gelir (lansman kampanyaları için). Saf fonksiyonlar — pytest'li.
"""
from __future__ import annotations

import datetime
from decimal import Decimal, ROUND_HALF_UP

from core.config import settings


def effective_commission_rate(
    override: Decimal | None,
    override_until: datetime.datetime | None,
    *,
    now: datetime.datetime | None = None,
    default: Decimal | None = None,
) -> Decimal:
    """Geçerli komisyon oranı. Bitiş tarihli override aktifse onu, değilse varsayılanı.

    - override yoksa → varsayılan (global oran).
    - override var, until None → süresiz override.
    - override var, until dolu → ``now < until`` ise override, değilse varsayılan.
    """
    base = (
        default if default is not None
        else Decimal(str(settings.PLATFORM_COMMISSION_RATE))
    )
    if override is None:
        return base
    if override_until is not None:
        ref = now or datetime.datetime.now(datetime.timezone.utc)
        if ref >= override_until:
            return base
    return override


def split(amount: Decimal, rate: Decimal) -> tuple[Decimal, Decimal]:
    """(komisyon, kazanç) — komisyon = amount × rate, 2 ondalık (HALF_UP)."""
    commission = (amount * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    earning = (amount - commission).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return commission, earning


def rate_for(entity) -> Decimal:
    """PayoutMixin'li varlığın (Tutor/Library) geçerli komisyon oranı."""
    return effective_commission_rate(
        getattr(entity, "commission_rate_override", None),
        getattr(entity, "commission_override_until", None),
    )


def launch_promo_stamp(
    now: datetime.datetime | None = None,
) -> tuple[Decimal | None, datetime.datetime | None]:
    """Lansman promosyonu açıksa (``LAUNCH_PROMO_MONTHS`` > 0) kayıt anında
    tedarikçiye damgalanacak (override_rate, override_until)'i döner; kapalıysa
    (None, None). Böylece her eğitmenin kendi ilk N ayı indirimli/0 komisyon olur."""
    months = int(settings.LAUNCH_PROMO_MONTHS or 0)
    if months <= 0:
        return None, None
    ref = now or datetime.datetime.now(datetime.timezone.utc)
    until = ref + datetime.timedelta(days=30 * months)
    return Decimal(str(settings.LAUNCH_PROMO_COMMISSION_RATE)), until
