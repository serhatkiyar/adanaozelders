from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, Field


# ── Oturum (deneme sınavı etkinliği) ─────────────────────────────────────────────


class ExamSessionCreate(BaseModel):
    # Opsiyonel katalog (blueprint) bağı; doluysa ortak deneme/cevap anahtarı paylaşılır.
    catalog_id: int | None = None
    exam_type: str = Field(min_length=1, max_length=20)  # TYT/AYT/YKS/YDT/LGS…
    title: str = Field(min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=3000)
    starts_at: datetime.datetime
    duration_minutes: int = Field(ge=1, le=1440)
    capacity: int = Field(ge=1, le=100000)
    price: float = Field(ge=0, le=1_000_000)


class ExamSessionUpdate(BaseModel):
    catalog_id: int | None = None
    exam_type: str | None = Field(default=None, min_length=1, max_length=20)
    title: str | None = Field(default=None, min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=3000)
    starts_at: datetime.datetime | None = None
    duration_minutes: int | None = Field(default=None, ge=1, le=1440)
    capacity: int | None = Field(default=None, ge=1, le=100000)
    price: float | None = Field(default=None, ge=0, le=1_000_000)


class ExamSessionOut(BaseModel):
    # RegistrationOut.session ORM relationship'inden (reg.session) model_validate
    # ile doldurulabildiği için from_attributes + Decimal->str coercion gerekir;
    # aksi halde nested validation 500 verir (price Numeric, ORM instance).
    model_config = ConfigDict(from_attributes=True, coerce_numbers_to_str=True)

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
    # Katalog (blueprint) bağı + sonuç durumu.
    catalog_id: int | None = None
    catalog_name: str | None = None
    is_nationwide: bool = False
    # Etkin cevap anahtarı (session.answer_key_url or catalog.answer_key_url).
    answer_key_url: str | None = None
    results_published: bool = False
    # Yönetim listesinde: kaç katılımcının sonucu girilmiş (operatör ilerlemesi).
    results_entered_count: int = 0


# ── Kayıt + bilet ────────────────────────────────────────────────────────────────


class RegistrationCreate(BaseModel):
    session_id: int


class RegistrationOut(BaseModel):
    # amount Numeric (Decimal) kolonundan gelir ama frontend string bekler; Pydantic'in
    # Decimal -> str coercion'ı olmadan model_validate(r) hata verir (commit SONRASI 500).
    model_config = ConfigDict(from_attributes=True, coerce_numbers_to_str=True)

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
    # QR okutulamazsa elle girilen kısa kod (yalnız PAID).
    short_code: str | None = None
    created_at: datetime.datetime
    # Oturum özeti (öğrencinin "biletlerim" listesinde göstermek için).
    session: ExamSessionOut | None = None
    # ── Sınav sonucu (yalnız oturum yayınlandıysa öğrenciye döner) ──
    result_published: bool = False
    result_document_url: str | None = None  # bireysel karne (PDF/görsel) — birincil
    result_net: str | None = None  # opsiyonel toplam net (Decimal -> string)
    result_rank: int | None = None  # opsiyonel sıralama


# ── Sonuç girişi (operatör / admin) ──────────────────────────────────────────────


class ResultSummaryIn(BaseModel):
    """Opsiyonel hızlı özet (karne başlığından): toplam net + sıralama.
    Karne PDF'i asıl teslimdir; bu alanlar yalnız listede özet göstermek için."""

    net: float | None = Field(default=None, ge=0, le=1000)
    rank: int | None = Field(default=None, ge=1, le=10_000_000)


class RosterRow(BaseModel):
    """Operatör katılımcı/sonuç tablosu satırı."""

    registration_id: int
    client_name: str
    status: str
    attended_at: datetime.datetime | None = None
    result_document_url: str | None = None
    result_net: str | None = None
    result_rank: int | None = None


class BulkDocumentOut(BaseModel):
    """Toplu karne (PDF) yükleme sonucu özeti."""

    matched: int = 0  # dosya adından kayda eşlenip yüklenen karne sayısı
    skipped: int = 0
    errors: list[str] = Field(default_factory=list)


class PublishResultsOut(BaseModel):
    published_count: int = 0  # karnesi olan + bildirilen öğrenci sayısı
    message: str


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
