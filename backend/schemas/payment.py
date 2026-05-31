from __future__ import annotations

import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from models.payment import PaymentStatus


class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    booking_id: int
    amount: Decimal
    commission_amount: Decimal
    tutor_earning: Decimal
    commission_rate: Decimal
    currency: str
    status: PaymentStatus
    provider: str
    paid_at: datetime.datetime | None = None
    released_at: datetime.datetime | None = None
    refunded_at: datetime.datetime | None = None
    created_at: datetime.datetime
    # pay endpoint'inde prod (3DS) için doldurulur; fake sağlayıcıda None.
    redirect_url: str | None = None


class EarningsSummary(BaseModel):
    released: Decimal  # tamamlanan derslerden net kazanç
    pending: Decimal   # emanette bekleyen (HELD) net tutar


class PlatformSummary(BaseModel):
    commission_total: Decimal
    volume_total: Decimal
