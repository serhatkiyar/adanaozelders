from __future__ import annotations

import datetime
import re
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator, model_validator

from core.config import settings
from models.booking import BookingStatus
from models.payment import PaymentStatus
from schemas.payment import PaymentOut
from schemas.tutor import TeachingMode

class BookingResourceCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    url: str = Field(..., max_length=2048)

    @field_validator("url")
    @classmethod
    def _validate_url_scheme(cls, v: str) -> str:
        # Yalnızca http/https; javascript:/data:/mailto:/tel: gibi şemalar
        # XSS/phishing ve aracılık-dışı (disintermediation) riski taşır.
        v = v.strip()
        if not re.match(r"^https?://", v, re.IGNORECASE):
            raise ValueError("URL http:// veya https:// ile başlamalıdır")
        return v

class BookingResourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    booking_id: int
    uploader_role: str
    uploader_id: int
    title: str
    kind: str = "link"  # "link" | "file"
    url: str
    file_name: str | None = None
    content_type: str | None = None
    size_bytes: int | None = None
    created_at: datetime.datetime

class BookingCommentCreate(BaseModel):
    body: str

class BookingCommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    booking_id: int
    sender_role: str
    sender_id: int
    body: str
    created_at: datetime.datetime


class BookingPrivateNoteCreate(BaseModel):
    body: str


class BookingPrivateNoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    booking_id: int
    owner_role: int
    owner_id: int
    body: str
    created_at: datetime.datetime


class BookingLocationUpdate(BaseModel):
    location: str
    location_lat: float | None = None
    location_lng: float | None = None

class BookingCreate(BaseModel):
    tutor_id: int
    start_at: datetime.datetime
    end_at: datetime.datetime
    # NOT: Fiyat istemciden ALINMAZ; sunucuda eğitmen ücreti × süre ile hesaplanır
    # (bkz. booking_service._compute_price). Manipülasyonu önlemek için şemada yok.
    notes: str | None = None
    mode: TeachingMode | None = None  # ONLINE | IN_PERSON (BOTH seçilemez)
    location: str | None = Field(default=None, max_length=300)
    location_lat: float | None = None
    location_lng: float | None = None
    # Öğrenci ücretsiz ilk dersi talep ediyor mu? Uygunluk sunucuda doğrulanır
    # (eğitmen ücretsiz ilk ders sunuyor + öğrencinin bu eğitmenle önceki dersi yok).
    free_lesson: bool = False

    @model_validator(mode="after")
    def _validate_window(self) -> "BookingCreate":
        if self.start_at.tzinfo is None or self.end_at.tzinfo is None:
            raise ValueError("start_at and end_at must be timezone-aware")
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class BookingCancel(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class BookingIssueReport(BaseModel):
    reason: Literal["TUTOR_ABSENT", "LESSON_NOT_HELD", "OTHER"]
    note: str | None = Field(default=None, max_length=1000)


class BookingLocation(BaseModel):
    location: str = Field(min_length=1, max_length=300)


class BookingReschedule(BaseModel):
    start_at: datetime.datetime
    end_at: datetime.datetime

    @model_validator(mode="after")
    def _validate_window(self) -> "BookingReschedule":
        if self.start_at.tzinfo is None or self.end_at.tzinfo is None:
            raise ValueError("start_at and end_at must be timezone-aware")
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class BookingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    tutor_id: int
    client_id: int
    status: BookingStatus
    start_at: datetime.datetime
    end_at: datetime.datetime
    price: Decimal | None = None
    is_free_lesson: bool = False
    notes: str | None = None
    cancel_reason: str | None = None
    mode: str | None = None
    location: str | None = None
    location_lat: float | None = None
    location_lng: float | None = None
    meeting_room: str | None = None
    created_at: datetime.datetime
    # Görüntüleme için; list_bookings/get_booking doldurur, aksiyon yanıtlarında da set edilir.
    tutor_name: str | None = None
    tutor_avatar_url: str | None = None
    client_name: str | None = None
    client_avatar_url: str | None = None
    # Bu rezervasyon için aktif bir değerlendirme var mı? list_bookings/get_booking doldurur.
    reviewed: bool = False
    # Öğrenci bu dersi ŞİMDİ değerlendirebilir mi? Kural `review_service`
    # içinde tek yerde: tamamlanmış + kartla ödenmiş + bu eğitmene ilk yorum.
    can_review: bool = False
    resources: list[BookingResourceOut] = []
    comments: list[BookingCommentOut] = []
    private_notes: list[BookingPrivateNoteOut] = []
    # Escrow ödeme durumu (booking.payment 1:1, selectin yüklenir).
    payment: PaymentOut | None = None
    # Öğrenci onayı / sorun bildirimi / geç iptal (Modül 2).
    is_disputed: bool = False
    student_confirmed_at: datetime.datetime | None = None
    issue_reported_at: datetime.datetime | None = None
    issue_reason: str | None = None
    issue_note: str | None = None
    late_cancel: bool = False

    @computed_field  # type: ignore[prop-decorator]
    @property
    def issue_report_deadline(self) -> datetime.datetime:
        """Öğrencinin sorun bildirebileceği son an (bitiş + onay penceresi)."""
        end = self.end_at if self.end_at.tzinfo else self.end_at.replace(tzinfo=datetime.timezone.utc)
        return end + datetime.timedelta(hours=settings.LESSON_CONFIRM_WINDOW_HOURS)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def late_for_changes(self) -> bool:
        """Kabul edilmiş derse iptal/erteleme eşiğinden az mı kaldı (sunucu saati)."""
        if self.status != BookingStatus.ACCEPTED:
            return False
        start = self.start_at if self.start_at.tzinfo else self.start_at.replace(tzinfo=datetime.timezone.utc)
        return start - datetime.datetime.now(datetime.timezone.utc) < datetime.timedelta(
            hours=settings.LESSON_LATE_CANCEL_HOURS
        )

    @model_validator(mode="after")
    def _gate_meeting_room(self) -> "BookingOut":
        """Canlı ders odası, ödeme yapılmadan ifşa edilmesin (anti-bedava ders).
        Oda yalnızca ödeme emanete alındığında (HELD/RELEASED) ya da ders
        ücretsizse (ilk ders ücretsiz, price==0) görünür. Aksi halde istemci
        odaya erişemez → ödeme yapmadan canlı ders başlatılamaz."""
        if not self.meeting_room:
            return self
        paid = self.payment is not None and self.payment.status in (
            PaymentStatus.HELD,
            PaymentStatus.RELEASED,
        )
        free = self.price is not None and self.price == 0
        if not (paid or free):
            self.meeting_room = None
        return self
