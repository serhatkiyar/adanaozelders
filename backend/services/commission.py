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
    created_at: datetime.datetime | None = None,
    now: datetime.datetime | None = None,
    default: Decimal | None = None,
) -> Decimal:
    """Geçerli komisyon oranı. Öncelik sırası:

    1. **Tedarikçiye özel** bitiş tarihli override (admin "özel anlaşma") — aktifse o.
    2. **Global lansman promosyonu** — ``LAUNCH_PROMO_MONTHS`` > 0 ise tedarikçinin
       ``created_at``'inden itibaren ilk N ay ``LAUNCH_PROMO_COMMISSION_RATE``. Eğitmen
       ve kütüphane için tek mekanizma (kayıt-anı damgalama yok).
    3. Aksi halde global ``PLATFORM_COMMISSION_RATE``.
    """
    base = (
        default if default is not None
        else Decimal(str(settings.PLATFORM_COMMISSION_RATE))
    )
    ref = now or datetime.datetime.now(datetime.timezone.utc)

    # 1) Tedarikçiye özel override (bitiş tarihli) önceliklidir.
    if override is not None and (override_until is None or ref < override_until):
        return override

    # 2) Global lansman promosyonu: tedarikçinin ilk N ayı (created_at'ten).
    months = int(settings.LAUNCH_PROMO_MONTHS or 0)
    if months > 0 and created_at is not None:
        window_end = created_at + datetime.timedelta(days=30 * months)
        if ref < window_end:
            return Decimal(str(settings.LAUNCH_PROMO_COMMISSION_RATE))

    return base


def split(amount: Decimal, rate: Decimal) -> tuple[Decimal, Decimal]:
    """(komisyon, kazanç) — komisyon = amount × rate, 2 ondalık (HALF_UP)."""
    commission = (amount * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    earning = (amount - commission).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return commission, earning


def rate_for(entity) -> Decimal:
    """PayoutMixin'li varlığın (Tutor/Library) geçerli komisyon oranı — tedarikçiye
    özel override + ``created_at``-bazlı lansman promosyonu dahil."""
    return effective_commission_rate(
        getattr(entity, "commission_rate_override", None),
        getattr(entity, "commission_override_until", None),
        created_at=getattr(entity, "created_at", None),
    )
