from __future__ import annotations

import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class PromotionPackageOut(BaseModel):
    """Katalog kalemi. Fiyat sunucudan gelir; istemci fiyat GÖNDERMEZ."""

    days: int
    price: Decimal
    label: str


class TutorPromotionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    package_days: int
    price: Decimal
    currency: str
    payment_status: str
    starts_at: datetime.datetime | None = None
    ends_at: datetime.datetime | None = None
    cancelled_at: datetime.datetime | None = None
    created_at: datetime.datetime


class TutorPromotionPurchaseIn(BaseModel):
    """Satın alma isteği. Yalnız SÜRE ve ONAY taşır — tutar taşımaz."""

    days: int = Field(ge=1, le=365)
    # Cayma hakkı istisnası ön onayı; sunucu tarafında da zorunludur.
    terms_accepted: bool = False


class TutorPromotionPurchaseOut(BaseModel):
    promotion: TutorPromotionOut
    #: Hosted checkout'a yönlendirme (fake sağlayıcıda None — anında kesinleşir).
    redirect_url: str | None = None


class AdminTutorPromotionOut(TutorPromotionOut):
    """Admin listesi: hangi eğitmen olduğu ve para izleri de görünür."""

    tutor_id: int
    tutor_name: str | None = None
    provider: str | None = None
    provider_ref: str | None = None
    paid_at: datetime.datetime | None = None
    refunded_amount: Decimal | None = None


class PromotionCancelIn(BaseModel):
    """İptal gerekçesi denetim kaydına yazılır (eğitmen reddi ile aynı disiplin)."""

    reason: str = Field(min_length=3, max_length=500)
