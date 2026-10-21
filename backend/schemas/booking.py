from __future__ import annotations

import datetime
import re
from decimal import Decimal
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    computed_field,
    field_serializer,
    field_validator,
    model_validator,
)

from core import canli_ders, ders_onay_hatirlatma, storage
from core.config import settings
from core.storage_types import PublicAsset
from models.booking import BookingStatus
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
        # Bağlantı dış adres olmalı: kendi depomuzdaki bir nesnenin adresi
        # (başkasının private dosyası dahil) bağlantı olarak eklenemez.
        if storage.key_from_url(v) is not None:
            raise ValueError("Dosyalar bağlantı olarak değil, yükleme ile eklenir")
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

    @field_serializer("url")
    def _url(self, v: str) -> str | None:
        # Yalnız yüklenen dosya imzalanır. Bağlantı dış adrestir; bizim
        # nesnemizi gösteren bir "bağlantı" (eski kayıt) yanıttan çıkarılır,
        # asla imzalanmaz.
        if self.kind == "file":
            return storage.resolve_url(v)
        return None if storage.key_from_url(v) is not None else v

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

#: Talep edilebilir ders süreleri (dakika). Slot ucu `duration` da bu kümeyle sınırlıdır.
LESSON_DURATIONS_MIN: tuple[int, ...] = (25, 45, 60, 90, 120)


def _validate_lesson_window(start_at: datetime.datetime, end_at: datetime.datetime) -> None:
    if start_at.tzinfo is None or end_at.tzinfo is None:
        raise ValueError("start_at and end_at must be timezone-aware")
    if end_at <= start_at:
        raise ValueError("end_at must be after start_at")
    if (end_at - start_at) not in {
        datetime.timedelta(minutes=m) for m in LESSON_DURATIONS_MIN
    }:
        raise ValueError("Ders süresi 30, 60, 90 ya da 120 dakika olmalı.")


#: Postgres INTEGER üst sınırı: taşan id sorguda 500 yerine şemada 422 alır.
_PG_INT_MAX = 2_147_483_647


class BookingCreate(BaseModel):
    tutor_id: int = Field(gt=0, le=_PG_INT_MAX)
    start_at: datetime.datetime
    end_at: datetime.datetime
    # NOT: Fiyat istemciden ALINMAZ; sunucuda eğitmen ücreti × süre ile hesaplanır
    # (bkz. booking_service._compute_price). Manipülasyonu önlemek için şemada yok.
    notes: str | None = Field(default=None, max_length=1000)  # arayüzdeki sınırla aynı
    mode: TeachingMode | None = None  # ONLINE | IN_PERSON (BOTH seçilemez)
    location: str | None = Field(default=None, max_length=300)
    location_lat: float | None = None
    location_lng: float | None = None
    # Öğrenci ücretsiz ilk dersi talep ediyor mu? Uygunluk sunucuda doğrulanır
    # (eğitmen ücretsiz ilk ders sunuyor + öğrencinin bu eğitmenle önceki dersi yok).
    is_trial: bool = False

    @model_validator(mode="after")
    def _validate_window(self) -> "BookingCreate":
        _validate_lesson_window(self.start_at, self.end_at)
        return self


class BookingOffer(BaseModel):
    """Eğitmenin kendi öğrencisine gönderdiği ders teklifi (Modül 8).

    Fiyat burada İSTİSNAİ olarak istemciden gelebilir: teklif eden taraf
    eğitmendir ve indirim yapabilmesi istenir. Sunucu yine de sınırı uygular —
    ilan ücretinin ÜSTÜNE çıkılamaz (bkz. booking_service.offer_lesson), yani
    öğrenci ilanda gördüğünden fazlasını ödemez.
    """

    client_id: int = Field(gt=0, le=_PG_INT_MAX)
    start_at: datetime.datetime
    end_at: datetime.datetime
    mode: TeachingMode | None = None
    notes: str | None = Field(default=None, max_length=500)
    location: str | None = Field(default=None, max_length=300)
    location_lat: float | None = None
    location_lng: float | None = None
    #: Boş bırakılırsa ilan ücreti × süre kullanılır.
    price: Decimal | None = Field(default=None, ge=0, le=100000, decimal_places=2)

    @model_validator(mode="after")
    def _validate_window(self) -> "BookingOffer":
        _validate_lesson_window(self.start_at, self.end_at)
        return self


class BookingCancel(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class BookingIssueReport(BaseModel):
    reason: Literal["TUTOR_ABSENT", "LESSON_NOT_HELD", "OTHER"]
    note: str | None = Field(default=None, max_length=1000)


class BookingLocation(BaseModel):
    location: str = Field(min_length=1, max_length=300)


class BookingTutorReschedule(BaseModel):
    """Öğretmenin ertelemesi: yalnız yeni başlangıç; süre ve ücret aynı kalır."""

    start_at: datetime.datetime


class BookingReschedule(BaseModel):
    start_at: datetime.datetime
    end_at: datetime.datetime

    @model_validator(mode="after")
    def _validate_window(self) -> "BookingReschedule":
        _validate_lesson_window(self.start_at, self.end_at)
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
    is_trial: bool = False
    notes: str | None = None
    cancel_reason: str | None = None
    mode: str | None = None
    # "ESCROW" (platformda kartla) | "DIRECT" (eğitmene doğrudan) | None
    # (henüz kabul edilmedi). İlk kabulde sunucuda yazılır.
    payment_channel: str | None = None
    location: str | None = None
    location_lat: float | None = None
    location_lng: float | None = None
    meeting_room: str | None = None
    created_at: datetime.datetime
    # Görüntüleme için; list_bookings/get_booking doldurur, aksiyon yanıtlarında da set edilir.
    tutor_name: str | None = None
    tutor_avatar_url: PublicAsset | None = None
    client_name: str | None = None
    client_avatar_url: PublicAsset | None = None
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
    #: Dersi eğitmen teklif etti; PENDING'de yanıtı öğrenci verir (Modül 8).
    offered_by_tutor: bool = False
    # Öğrenci onayı / sorun bildirimi / geç iptal (Modül 2).
    is_disputed: bool = False
    student_confirmed_at: datetime.datetime | None = None
    issue_reported_at: datetime.datetime | None = None
    issue_reason: str | None = None
    issue_note: str | None = None
    late_cancel: bool = False
    # İptali yapan rol id'si ve anı (Modül 7); eski iptallerde NULL.
    cancelled_by_role: int | None = None
    cancelled_at: datetime.datetime | None = None
    #: Haftalık seriden üretilen teklifse serinin id'si.
    series_id: int | None = None
    #: Öğretmen dersi başka zamana aldı, öğrencinin yanıtı bekleniyor: eski
    #: başlangıç (24 Eyl 2026). NULL ise bekleyen bir saat değişikliği yok.
    tutor_rescheduled_from: datetime.datetime | None = None
    confirm_reminded_at: datetime.datetime | None = None
    #: ORM'deki atanmış sağlayıcı (kolon `canli_ders_saglayici`). Yanıta
    #: çıkmaz; dışarıya aynı adlı hesaplanan alan (varsayılana düşerek) çıkar.
    atanan_saglayici: str | None = Field(
        default=None, validation_alias="canli_ders_saglayici", exclude=True
    )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_remind_confirm(self) -> bool:
        """Öğretmen "Onaylamayı hatırlat" gönderebilir mi (kural tek yerde)."""
        return ders_onay_hatirlatma.can_remind_confirm(self)

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

    @computed_field  # type: ignore[prop-decorator]
    @property
    def free_cancel_until(self) -> datetime.datetime | None:
        """Onaylı derste ücretsiz iptalin son anı (başlangıç − geç iptal eşiği).

        Onay bekleyen talep her zaman ücretsiz iptal edilir; terminal derste
        iptal yoktur. İkisinde de null.
        """
        if self.status != BookingStatus.ACCEPTED:
            return None
        start = self.start_at if self.start_at.tzinfo else self.start_at.replace(tzinfo=datetime.timezone.utc)
        return start - datetime.timedelta(hours=settings.LESSON_LATE_CANCEL_HOURS)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def canli_ders_saglayici(self) -> Literal["zoom", "agora", "livekit", "jitsi"] | None:
        """"Derse katıl" hangi altyapıya gider? Yalnız ONLINE derste ve oda adı
        görünürken (ödeme kapısı `_gate_meeting_room` sonrası) dolu; aksi halde
        null — istemci düğmeyi göstermez.

        zoom/agora paralel çalışırken derse atanmış sağlayıcı döner; henüz
        atanmamışsa (ilk giriş biletinden önce) varsayılan. Kesin değer
        `/canli-ders-bileti` yanıtındaki `saglayici`dır."""
        if self.mode != "ONLINE" or not self.meeting_room:
            return None
        varsayilan = settings.CANLI_DERS_SAGLAYICI
        if varsayilan in canli_ders.PARALEL_SAGLAYICILAR and self.atanan_saglayici in (
            canli_ders.PARALEL_SAGLAYICILAR
        ):
            return self.atanan_saglayici  # type: ignore[return-value]
        return varsayilan

    @model_validator(mode="after")
    def _gate_meeting_room(self) -> "BookingOut":
        """Canlı ders odası, ödeme yapılmadan ifşa edilmesin (anti-bedava ders).
        Oda yalnızca ödeme emanete alındığında (HELD/RELEASED) ya da ders
        ücretsizse (ilk ders ücretsiz, price==0) görünür. Aksi halde istemci
        odaya erişemez → ödeme yapmadan canlı ders başlatılamaz.

        Kural tek kaynakta: `core/canli_ders.py::ders_odasi_acik_mi`. Token
        uçları (`api/routers/bookings.py::_canli_ders_kapilari`) ORM'den
        okudukları için bu şemadan geçmez; aynı yardımcıyı çağırırlar."""
        if not self.meeting_room:
            return self
        payment_status = self.payment.status if self.payment is not None else None
        if not canli_ders.ders_odasi_acik_mi(
            payment_status, self.price, payment_channel=self.payment_channel
        ):
            self.meeting_room = None
        return self


# ── Canlı ders (LiveKit) ─────────────────────────────────────────────────────


class LiveLessonTokenOut(BaseModel):
    """GET /bookings/{id}/live-token yanıtı.

    `token` kısa ömürlüdür ve YALNIZ `room` odası için geçerlidir; istemci
    bunu saklamaz, ders penceresinde yeniden ister.
    """

    url: str
    token: str
    room: str
    identity: str
    expires_at: datetime.datetime


class ZoomDersTokenOut(BaseModel):
    """GET /bookings/{id}/zoom-token yanıtı (Zoom Video SDK).

    `token` Video SDK JWT'sidir; YALNIZ `oturum_adi` oturumu için geçerlidir.
    `oturum_adi` ve `kullanici_adi` sunucudan gelir — istemci kendisi seçmez.
    Eğitmen `host` (role_type=1), öğrenci `katilimci` (role_type=0).
    """

    token: str
    oturum_adi: str
    kullanici_adi: str
    rol: Literal["host", "katilimci"]
    expires_at: datetime.datetime


class AgoraKarsiTaraf(BaseModel):
    """Dersin öteki tarafı: istemci uzak kullanıcıyı uid'inden tanır."""

    uid: str
    ad: str
    rol: Literal["ogretmen", "ogrenci"]


class AgoraEkranBileti(BaseModel):
    """Ekran paylaşımı için ikinci istemcinin uid'i (`{uid}-ekran`) ve token'ı."""

    uid: str
    token: str


class AgoraDersTokenOut(BaseModel):
    """Agora RTC giriş bileti (`/canli-ders-bileti` içinde `agora`).

    `token` AccessToken2'dir; YALNIZ `kanal` + `uid` için geçerlidir. uid
    sunucuda üretilir: öğretmen `t{tutor_id}`, öğrenci `c{client_id}`.
    `expires_at` ders penceresini (bitiş + katılım kapanışı) asla aşmaz.
    """

    app_id: str
    kanal: str
    uid: str
    token: str
    rol: Literal["ogretmen", "ogrenci"]
    ad: str
    karsi: AgoraKarsiTaraf | None = None
    ekran: AgoraEkranBileti
    expires_at: datetime.datetime


class CanliDersBiletiOut(BaseModel):
    """GET /bookings/{id}/canli-ders-bileti — sağlayıcıdan bağımsız bilet.

    `saglayici` dersin KALICI atanmış sağlayıcısıdır; yalnız ona ait alan
    doludur (öteki null).
    """

    saglayici: Literal["zoom", "agora"]
    zoom: ZoomDersTokenOut | None = None
    agora: AgoraDersTokenOut | None = None


# ── Ders talep ızgarası (Modül 3): GET /tutors/{id}/slots ────────────────────


class SlotOut(BaseModel):
    start_at: datetime.datetime
    end_at: datetime.datetime
    status: Literal["available", "busy"]
    part_of_day: Literal["night", "morning", "afternoon", "evening"]


class SlotDayOut(BaseModel):
    date: datetime.date  # İstanbul tarihi
    has_available: bool
    slots: list[SlotOut]


class SlotPolicyOut(BaseModel):
    min_notice_hours: int
    window_days: int
    late_cancel_hours: int


class SlotPriceOut(BaseModel):
    # Seçilen süre için sunucuda hesaplanır; eğitmen ücret girmediyse null.
    amount: str | None
    currency: Literal["TRY"] = "TRY"


class SlotsOut(BaseModel):
    days: list[SlotDayOut]
    # Eğitmenin hiç müsaitlik penceresi var mı (yoksa talep gönderilemez).
    has_availability: bool
    # Bu andan (dahil) sonra talep edilemez.
    window_end: datetime.datetime
    policy: SlotPolicyOut
    price: SlotPriceOut


# ── Haftalık ders teklifi serisi ─────────────────────────────────────────────


class LessonSeriesIn(BaseModel):
    """Eğitmenin haftalık ders serisi teklifi.

    Ücret tek teklifteki gibi istemciden gelebilir (indirim), sunucu ilan
    ücretinin üstüne çıkılmasını reddeder ve her üretimde
    ``min(seri ücreti, güncel ilan ücreti × süre)`` uygular.
    """

    client_id: int
    first_start_at: datetime.datetime
    duration_min: Literal[25, 45, 60, 90, 120]
    weeks: int = Field(ge=2, le=12)
    mode: TeachingMode | None = None
    notes: str | None = Field(default=None, max_length=500)
    location: str | None = Field(default=None, max_length=300)
    location_lat: float | None = None
    location_lng: float | None = None
    price: Decimal | None = Field(default=None, ge=0, le=100000, decimal_places=2)

    @model_validator(mode="after")
    def _saat_dilimi_zorunlu(self) -> "LessonSeriesIn":
        if self.first_start_at.tzinfo is None:
            raise ValueError("first_start_at saat dilimi içermeli")
        return self


class SeriesOccurrenceOut(BaseModel):
    index: int
    start_at: datetime.datetime
    end_at: datetime.datetime
    status: Literal["OFFER_NOW", "LATER", "CONFLICT"]
    reason: (
        Literal[
            "TOO_SOON",
            "TIME_OFF",
            "OUTSIDE_AVAILABILITY",
            "TUTOR_BUSY",
            "STUDENT_BUSY",
        ]
        | None
    ) = None


class LessonSeriesPreviewOut(BaseModel):
    occurrences: list[SeriesOccurrenceOut]
    offer_now_count: int
    later_count: int
    conflict_count: int
    window_end: datetime.datetime
    # İlk ders için sunucuda hesaplanan ders başı ücret.
    price: SlotPriceOut


class LessonSeriesOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    tutor_id: int
    client_id: int
    weekday: int
    start_minute: int
    duration_min: int
    first_date: datetime.date
    weeks: int
    price: Decimal | None = None
    mode: str | None = None
    status: Literal["ACTIVE", "ENDED"]
    generated_until: datetime.date | None = None
    ended_at: datetime.datetime | None = None
    created_at: datetime.datetime


class LessonSeriesCreatedOut(BaseModel):
    series: LessonSeriesOut
    offered: list[BookingOut]
    skipped: list[SeriesOccurrenceOut]


class TahtaTokenOut(BaseModel):
    """GET /bookings/{id}/tahta-token yanıtı (ders tahtası, Centrifugo).

    `token` YALNIZ `kanal` için abonelik JWT'sidir; kanal adı sunucudan gelir.
    `tahta_acik` geç katılan / yeniden bağlanan tarafın son durumu okumasıdır.
    """

    token: str
    kanal: str
    ttl: int
    rol: Literal["ogretmen", "ogrenci"]
    tahta_acik: bool


class TahtaDurumIn(BaseModel):
    acik: bool


class TahtaDurumOut(BaseModel):
    acik: bool
