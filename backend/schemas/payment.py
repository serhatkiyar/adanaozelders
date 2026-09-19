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
    released: Decimal              # tamamlanan derslerden net kazanç (RELEASED)
    pending: Decimal               # emanette bekleyen (HELD) net tutar
    this_month: Decimal = Decimal("0")  # bu ay serbest bırakılan net kazanç
    refunded: Decimal = Decimal("0")    # iade edilen brüt tutar
    commission_rate: Decimal       # şu anki geçerli komisyon oranı (commission.rate_for)
    currency: str = "TRY"


class EarningTransaction(BaseModel):
    """Bakiye sayfasındaki tek bir kazanç hareketi (ders / deneme / çalışma).

    Hem eğitmen (ders ödemeleri) hem kütüphane (deneme + çalışma escrow'u) için ortak
    biçim. ``status`` daima Payment sözlüğünde normalize edilir
    (PENDING/HELD/RELEASED/REFUNDED/FAILED/CANCELLED) — frontend tek rozet mantığı kullanır.
    """

    id: int
    source: str                    # LESSON | EXAM | STUDY
    title: str
    counterparty: str | None = None  # karşı taraf (öğrenci adı)
    gross: Decimal                 # öğrencinin ödediği toplam
    commission: Decimal            # platform komisyonu
    net: Decimal                   # tedarikçi kazancı (tutor/library)
    status: str
    currency: str
    occurred_at: datetime.datetime | None = None  # serbest/ödeme/oluşturma tarihi
    created_at: datetime.datetime


class PlatformSummary(BaseModel):
    commission_total: Decimal
    volume_total: Decimal
