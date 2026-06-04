from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, Field


class StudyReservationCreate(BaseModel):
    library_id: int
    starts_at: datetime.datetime
    ends_at: datetime.datetime


class StudyQuoteOut(BaseModel):
    """Rezervasyon öncesi fiyat + uygunluk ön bilgisi."""

    available: bool
    capacity: int
    remaining: int
    hourly_price: str  # Decimal -> string
    hours: float
    amount: str  # Decimal -> string
    currency: str
    reason: str | None = None  # uygun değilse neden (ör. "Kapasite dolu")


class StudyReservationOut(BaseModel):
    # amount Numeric (Decimal) kolonundan gelir ama frontend string bekler; Pydantic'in
    # Decimal -> str coercion'ı olmadan model_validate(r) hata verir (commit SONRASI 500).
    model_config = ConfigDict(from_attributes=True, coerce_numbers_to_str=True)

    id: int
    library_id: int
    library_name: str | None = None
    library_slug: str | None = None
    client_id: int
    starts_at: datetime.datetime
    ends_at: datetime.datetime
    status: str
    amount: str  # Decimal -> string
    currency: str
    paid_at: datetime.datetime | None = None
    attended_at: datetime.datetime | None = None
    qr_token: str | None = None
    short_code: str | None = None
    created_at: datetime.datetime


class StudyPayResult(BaseModel):
    reservation: StudyReservationOut
    redirect_url: str | None = None
