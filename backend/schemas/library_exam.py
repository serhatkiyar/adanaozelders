from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, Field


# ── Oturum (deneme sınavı etkinliği) ─────────────────────────────────────────────


class ExamSessionCreate(BaseModel):
    exam_type: str = Field(min_length=1, max_length=20)  # TYT/AYT/YKS/YDT/LGS…
    title: str = Field(min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=3000)
    starts_at: datetime.datetime
    duration_minutes: int = Field(ge=1, le=1440)
    capacity: int = Field(ge=1, le=100000)
    price: float = Field(ge=0, le=1_000_000)


class ExamSessionUpdate(BaseModel):
    exam_type: str | None = Field(default=None, min_length=1, max_length=20)
    title: str | None = Field(default=None, min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=3000)
    starts_at: datetime.datetime | None = None
    duration_minutes: int | None = Field(default=None, ge=1, le=1440)
    capacity: int | None = Field(default=None, ge=1, le=100000)
    price: float | None = Field(default=None, ge=0, le=1_000_000)


class ExamSessionOut(BaseModel):
    id: int
    library_id: int
    library_name: str | None = None
    library_slug: str | None = None
    exam_type: str
    title: str
    description: str | None = None
    starts_at: datetime.datetime
    duration_minutes: int
    capacity: int
    price: str  # Decimal -> string
    currency: str
    status: str
    registered_count: int = 0
    available: int = 0
    # İstek sahibi öğrencinin bu oturumdaki kayıt durumu (varsa).
    my_status: str | None = None
    my_registration_id: int | None = None


# ── Kayıt + bilet ────────────────────────────────────────────────────────────────


class RegistrationCreate(BaseModel):
    session_id: int


class RegistrationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    client_id: int
    status: str
    amount: str  # Decimal -> string
    currency: str
    paid_at: datetime.datetime | None = None
    attended_at: datetime.datetime | None = None
    # Yalnız ödeme yapılmış (PAID) kayıtlarda dolu; QR olarak gösterilir.
    qr_token: str | None = None
    created_at: datetime.datetime
    # Oturum özeti (öğrencinin "biletlerim" listesinde göstermek için).
    session: ExamSessionOut | None = None


class PayResult(BaseModel):
    registration: RegistrationOut
    # Prod 3DS sağlayıcıda doldurulur; fake sağlayıcıda None (anında ödeme).
    redirect_url: str | None = None


# ── Operatör QR doğrulama ────────────────────────────────────────────────────────


class QRVerifyIn(BaseModel):
    # QR içeriği: "{registration_id}:{token}" veya salt token.
    payload: str = Field(min_length=4, max_length=120)


class AttendanceResult(BaseModel):
    registration_id: int
    client_name: str
    exam_title: str
    status: str
    already: bool = False  # daha önce doğrulanmış mıydı
    message: str
