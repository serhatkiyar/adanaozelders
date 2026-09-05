"""Kendi-filo teslimat (dağıtım turu) request/response şemaları."""
from __future__ import annotations

import datetime
import re

from pydantic import BaseModel, Field, field_validator


# ── Filo (İP-19) ─────────────────────────────────────────────────────────────


class VehicleCreate(BaseModel):
    code: str = Field(min_length=1, max_length=20, pattern=r"^[A-Z0-9_-]+$")
    label: str = Field(min_length=1, max_length=50)
    plate: str | None = Field(default=None, max_length=20)
    profile: str = Field(default="car", pattern="^(car|bike|foot)$")
    max_stops: int | None = Field(default=None, ge=1, le=500)
    shift_start: datetime.time | None = None
    shift_end: datetime.time | None = None
    fixed_cost: int = Field(default=0, ge=0)
    start_point_id: int | None = None
    sort_order: int = 0


class VehicleUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=50)
    plate: str | None = Field(default=None, max_length=20)
    profile: str | None = Field(default=None, pattern="^(car|bike|foot)$")
    max_stops: int | None = Field(default=None, ge=1, le=500)
    shift_start: datetime.time | None = None
    shift_end: datetime.time | None = None
    fixed_cost: int | None = Field(default=None, ge=0)
    start_point_id: int | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class VehicleOut(BaseModel):
    id: int
    code: str
    label: str
    plate: str | None = None
    profile: str
    max_stops: int | None = None
    shift_start: datetime.time | None = None
    shift_end: datetime.time | None = None
    fixed_cost: int
    start_point_id: int | None = None
    sort_order: int
    is_active: bool


class PickupPointCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    kind: str = Field(pattern="^(BASE|SUPPLIER)$")
    address: str | None = Field(default=None, max_length=2000)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    sort_order: int = 0


class PickupPointUpdate(BaseModel):
    """Başlangıç/toplama noktası düzenlemesi (denetim B-9).

    `kind` DEĞİŞTİRİLEMEZ: bir BASE'i SUPPLIER'a çevirmek, ona bağlı araçların
    turunu sessizce başka bir yerden başlatırdı. Yanlış tür girildiyse doğru
    olanı eklenir, yanlış olan pasifleştirilir.
    """

    name: str | None = Field(default=None, min_length=1, max_length=80)
    address: str | None = Field(default=None, max_length=2000)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    sort_order: int | None = None
    is_active: bool | None = None


class PickupPointOut(BaseModel):
    id: int
    name: str
    kind: str
    address: str | None = None
    lat: float
    lng: float
    sort_order: int
    is_active: bool


class DeliveryMetricsOut(BaseModel):
    """Beş operasyon metriği (sözleşme §4.3) — hepsi MEVCUT alanlardan türer."""

    on_time_rate: float | None = None
    first_attempt_rate: float | None = None
    stops_per_hour: float | None = None
    fail_reasons: dict[str, int] = Field(default_factory=dict)
    km_per_delivery: float | None = None
    delivered: int = 0
    planned: int = 0


class DeliveryRunCreate(BaseModel):
    run_date: datetime.date
    # İP-19: araç artık regex'le değil FK ile doğrulanır — `vehicles.id`.
    vehicle_id: int
    notes: str | None = Field(default=None, max_length=2000)
    courier_id: int | None = None


class DeliveryRunUpdate(BaseModel):
    """Tur meta güncellemesi: kurye ve/veya araç ataması (İP-19, D-2)."""

    courier_id: int | None = None
    vehicle_id: int | None = None


class DispatchDayIn(BaseModel):
    """Günü Optimize Et girdisi."""

    run_date: datetime.date


# ── Kurye profili ─────────────────────────────────────────────────────────────────


class CourierCreate(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    phone: str | None = Field(default=None, max_length=30)


class CourierUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=150)
    phone: str | None = Field(default=None, max_length=30)
    is_active: bool | None = None


class CourierOut(BaseModel):
    id: int
    name: str
    phone: str | None = None
    photo_url: str | None = None
    is_active: bool


class StopItemOut(BaseModel):
    title: str
    quantity: int


class DeliveryStopOut(BaseModel):
    id: int
    run_id: int
    order_id: int
    sequence: int
    status: str
    # Paket etiketi + tarayıcı payload'ı (deneme bileti deseni: "{id}:{token}").
    qr_payload: str
    recipient: str | None = None
    phone: str | None = None
    address: str | None = None
    lat: float | None = None
    lng: float | None = None
    items: list[StopItemOut] = []
    order_total: str | None = None
    # Müşteri teslimat talimatı (siparişten okunur; kurye ekranında belirgin bant).
    delivery_pref: str | None = None
    delivery_pref_note: str | None = None
    # Rota optimizasyonu (Faz B)
    eta: datetime.datetime | None = None
    detour_km: float | None = None
    # detour_km >= DELIVERY_DETOUR_KM → "rotayı bozan" (dış kurye adayı)
    is_outlier: bool = False
    otp_sent_at: datetime.datetime | None = None
    delivered_at: datetime.datetime | None = None
    proof: str | None = None
    # Teslim kanıtı fotoğrafı (kapıya/komşuya bırakma; opsiyonel ek kanıt).
    photo_url: str | None = None
    courier_note: str | None = None
    # ── Dispatch board istisna sinyalleri (Faz 2) ──
    # Söz verilen teslim günü (geçmişse "söz riski" → operatör dikkat etmeli).
    promised_delivery_date: datetime.date | None = None
    # Bu sipariş kaç kez teslim edilemedi (>0 → öncelikli yeniden deneme).
    failed_attempts: int = 0
    # FAILED durakta yapısal neden kodu (FailReason).
    fail_reason: str | None = None


class DeliveryRunOut(BaseModel):
    id: int
    run_date: datetime.date
    # İP-19: `vehicle_id` FK; `vehicle` alanı KORUNDU ama artık aracın görünen
    # ETİKETİDİR (eski "LADA" kod-string'i değil) — saha/panel ekranları
    # doğrudan basar, VEHICLE_LABEL sözlüğü kalktı.
    vehicle_id: int
    vehicle: str
    status: str
    notes: str | None = None
    started_at: datetime.datetime | None = None
    completed_at: datetime.datetime | None = None
    created_at: datetime.datetime
    # Turun başlangıç noktası (navigasyon ilk ayağı). İP-19/K-9: aracın
    # `start_point`'i, yoksa varsayılan BASE; hiçbiri tanımlı değilse None.
    depot_lat: float | None = None
    depot_lng: float | None = None
    # Rota optimizasyonu (Faz B) — son optimize snapshot'ı
    optimized_at: datetime.datetime | None = None
    optimize_provider: str | None = None
    total_distance_km: float | None = None
    total_duration_seconds: int | None = None
    # Encoded polyline5 (vroom); haversine'de None → istemci düz çizgi çizer.
    route_geometry: str | None = None
    courier: CourierOut | None = None
    stops: list[DeliveryStopOut] = []


class EligibleOrderOut(BaseModel):
    """Tura eklenebilecek (ödenmiş + fiziksel + açıkta) sipariş özeti.
    Dış-kargo kuyruğu (`outsourced_orders`) da aynı şekli kullanır."""

    order_id: int
    recipient: str | None = None
    phone: str | None = None
    address: str | None = None
    city: str | None = None
    district: str | None = None
    lat: float | None = None
    lng: float | None = None
    total: str
    item_count: int
    #: Toplanacak fiziksel kalemler (başlık + adet). Operatör hazırlama
    #: kuyruğunda NE toplayacağını görmek zorunda; "N parça" özeti bunun yerine
    #: geçmez. Dijital kalemler dışarıda bırakılır (kutuya girmez).
    #:
    #: Ek sorgu MALİYETİ YOK: bu şemayı üreten dört sorgunun hepsi
    #: `selectinload(Order.items)` yapıyor (`item_count` de aynı koleksiyondan
    #: hesaplanıyordu).
    items: list[StopItemOut] = []
    created_at: datetime.datetime
    # Söz verilen teslim günü (16:00 cutoff kuralı) — eski siparişlerde None.
    promised_delivery_date: datetime.date | None = None
    # True=Cıncık bölgesi, False=bölge dışı, None=belirlenemedi.
    in_zone: bool | None = None
    # Hazırlama istasyonu damgası (PDS O1) — None ise henüz toplanmadı/etiketlenmedi.
    prepared_at: datetime.datetime | None = None


class StopsAddIn(BaseModel):
    order_ids: list[int] = Field(min_length=1, max_length=200)


class StopsReorderIn(BaseModel):
    """Turun TÜM duraklarının yeni sırası (permütasyon olmalı)."""

    stop_ids: list[int] = Field(min_length=1, max_length=200)


class OtpSendOut(BaseModel):
    masked_phone: str
    sent: bool


class OtpVerifyIn(BaseModel):
    code: str = Field(min_length=4, max_length=8)
    # Dağıtıcı telefonunun teslim anındaki konumu (kanıt; opsiyonel).
    lat: float | None = None
    lng: float | None = None


class StopFailIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
    # Yapısal neden kodu (FailReason). Verilmezse DIGER — geriye uyumlu.
    reason_code: str = Field(
        default="DIGER",
        pattern="^(EVDE_YOK|ADRES_SORUNU|ERISIM_SORUNU|ERKEN_DENEME|MUSTERI_TALEBI|GUVENLIK|PAKET_SORUNU|ARAC_SORUNU|DIGER)$",
    )


class OverrideDeliverIn(BaseModel):
    """OTP ulaşmadığında notlu yönetici teslimi (kaçış yolu)."""

    note: str = Field(min_length=3, max_length=500)


class TrackIn(BaseModel):
    """Dağıtıcı telefonunun anlık konumu (~10 sn'de bir)."""

    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class TimelineEventOut(BaseModel):
    """Müşteri olay akışı kalemi — yalnız kod + zaman (iç gerekçe/aktör SIZMAZ;
    bkz. services/delivery_timeline.py whitelist projeksiyonu)."""

    code: str
    at: datetime.datetime


class ShipmentItemOut(BaseModel):
    """Teslimat içindeki kalem — başlık + adet (fiyat/PII yok, sayfa oturumsuz)."""

    title: str
    quantity: int


class ShipmentOut(BaseModel):
    """Siparişin bir teslimatı ("1. Teslimat").

    Kaynak `order_packages`: paket = gönderi nesnesidir (F30). Paketi olmayan
    eski siparişler için sentetik TEK teslimat üretilir, böylece ekran her
    siparişte aynı listeyi görür. `VOID` paketler listeye girmez — bozulmuş
    paket müşteri için hiç var olmamıştır.

    Bugün bir siparişin tek teslimatı olur; liste, kısmi teslimat geldiğinde
    ("eldekini bugün gönder, kalanı temin edilince") çoğullaşmaya hazırdır.
    """

    #: Müşteriye gösterilen sıra: 1, 2, 3… (paket `package_no`'su değil —
    #: bozulan paketler numarayı atlatır, müşteri boşluk görmemeli).
    no: int
    #: NOT_DISPATCHED | EN_ROUTE | DELIVERED | FAILED | POSTPONED
    status: str
    items: list[ShipmentItemOut] = []
    #: Bu teslimat için söz verilen gün; bilinmiyorsa None ("temin ediliyor").
    promised_date: datetime.date | None = None
    delivered_at: datetime.datetime | None = None


class OrderTrackingOut(BaseModel):
    """Müşterinin sipariş takibi: kurye nerede, kaç durak önde, tahmini varış.

    status: NOT_DISPATCHED (bugünkü tura çıkmadı) | EN_ROUTE (dağıtımda) |
    DELIVERED | FAILED (bugün teslim edilemedi, yeniden planlanacak).
    """

    status: str
    #: Müşteriye gösterilen kalıcı sipariş numarası. `tracking_no` bunun yerine
    #: geçemez: o teslimat denemesine bağlıdır ve her başarısızlıkta değişir.
    order_no: str | None = None
    #: Teslimat ilerlemesi (services.order_identity.fulfillment_state):
    #: NONE | PARTIAL | ALL. Türetilir, saklanmaz.
    fulfillment_state: str = "NONE"
    shipments: list[ShipmentOut] = []
    sequence: int | None = None
    stops_ahead: int | None = None
    # Turdaki toplam durak ("önünde 3 / toplam 12" bağlamı).
    total_stops: int | None = None
    eta: datetime.datetime | None = None
    # Müşteri sözü penceresi ("18:00–19:00") — nokta ETA yerine bu gösterilir.
    eta_window_start: datetime.datetime | None = None
    eta_window_end: datetime.datetime | None = None
    courier_lat: float | None = None
    courier_lng: float | None = None
    courier_age_seconds: int | None = None
    ship_lat: float | None = None
    ship_lng: float | None = None
    # Kimlik/bağlam (oturumsuz sayfada da güvenli: alıcı maskeli, kurye public kimlik).
    tracking_no: str | None = None
    recipient_masked: str | None = None
    # Kapı/daire sayıları maskeli teslimat adresi (services.delivery_timeline.mask_address).
    address_masked: str | None = None
    promised_delivery_date: datetime.date | None = None
    courier_name: str | None = None
    courier_photo_url: str | None = None
    courier_plate: str | None = None
    # Self-servis (token'lı sayfadan da): mevcut talimat + erteleme hakkı.
    delivery_pref: str | None = None
    delivery_pref_note: str | None = None
    can_postpone: bool = False
    # Olay akışı (ORDER_RECEIVED → … → DELIVERED; Türkçe metin frontend'de).
    timeline: list[TimelineEventOut] = []
    # Teslim kanıtı (yalnız DELIVERED'da): saat + kanıt türü (OTP/ADMIN/PHOTO).
    delivered_at: datetime.datetime | None = None
    proof: str | None = None
    proof_photo_url: str | None = None
    # Teslim sonrası değerlendirme (Faz 7): verilebilir mi + verilmiş mi.
    can_feedback: bool = False
    feedback_given: bool = False


class DeliveryPrefIn(BaseModel):
    """Müşteri teslimat talimatı. KOMSUYA_BIRAK'ta note (komşu adı/daire) zorunlu."""

    pref: str = Field(pattern="^(ADRESIMDEYIM|KAPIYA_BIRAK|KOMSUYA_BIRAK|BENI_ARA)$")
    note: str | None = Field(default=None, max_length=200)


class ShipAddressChangeIn(BaseModel):
    """Adres değişikliği (yalnız oturumlu, dağıtıma çıkmadan). Bölge dışına
    düşerse 409 code=OUT_OF_ZONE; müşteri onaylarsa force=true ile yinelenir."""

    address_id: int
    force: bool = False


class CourierAccountCreate(BaseModel):
    """Admin, kurye profiline giriş hesabı açar (self-servis yok)."""

    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    first_name: str = Field(min_length=1, max_length=75)
    last_name: str = Field(min_length=1, max_length=75)


class CourierAccountOut(BaseModel):
    """Şifre/hash ASLA dönmez."""

    id: int
    email: str
    first_name: str
    last_name: str
    is_active: bool
    courier_id: int
    created_at: datetime.datetime


class CourierPasswordResetIn(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


class CourierWorkspaceOut(BaseModel):
    """Kurye açılış ekranı: hesabım + profilim + güncel turum (yoksa null)."""

    account: CourierAccountOut
    courier: CourierOut | None = None
    run: DeliveryRunOut | None = None


class ClosedDayOut(BaseModel):
    """Teslimata kapalı gün (admin takvimi)."""

    id: int
    day: datetime.date
    label: str | None = None
    source: str  # 'holiday' | 'manual'


class ClosedDayIn(BaseModel):
    day: datetime.date
    label: str | None = Field(default=None, max_length=120)


class CapacityDayOut(BaseModel):
    """Admin kapasite görünümü satırı — bir günün söz doluluğu (Faz 1).

    ``retry_debt``: o güne sözlü siparişlerden en az bir başarısız teslim
    denemesi olanlar — söz borcu; yeni satıştan önce gelir (PDS B7)."""

    day: datetime.date
    is_working_day: bool
    capacity: int  # 0 = kapasite kontrolü kapalı
    booked: int
    retry_debt: int


class DeliveryKpiOut(BaseModel):
    """Teslimat KPI özeti (PDS §14) — ham sayı + oran; HEDEF YOK (baseline).
    Oranlar payda 0 iken None (henüz veri yok)."""

    window_days: int
    delivered: int
    failed: int
    rescheduled: int
    delivered_count: int
    first_attempt_delivered: int
    first_attempt_rate: float | None = None
    on_time_delivered: int
    promised_delivered: int
    on_time_rate: float | None = None
    failure_rate: float | None = None
    failed_not_courier_fault: int
    fail_by_reason: dict[str, int] = {}
    # Teslim sonrası değerlendirme (Faz 7): 👍/👎 sayıları + sorun Pareto'su.
    feedback_up: int = 0
    feedback_down: int = 0
    satisfaction_rate: float | None = None
    feedback_problems: dict[str, int] = {}


_FEEDBACK_PROBLEM_PATTERN = (
    "^(GEC_TESLIMAT|HASARLI_PAKET|YANLIS_EKSIK_URUN|KURYE_DAVRANISI|"
    "TESLIM_YERI|BILDIRIM_SORUNU|DIGER)$"
)


class DeliveryFeedbackIn(BaseModel):
    """Teslim sonrası müşteri değerlendirmesi. 👎'de en az bir sorun kodu
    beklenir (yapısal Pareto; serbest metin opsiyonel ektir)."""

    thumbs_up: bool
    problem_codes: list[str] = Field(default_factory=list, max_length=7)
    comment: str | None = Field(default=None, max_length=500)

    @field_validator("problem_codes")
    @classmethod
    def _valid_codes(cls, v: list[str]) -> list[str]:
        seen: list[str] = []
        for code in v:
            if not re.match(_FEEDBACK_PROBLEM_PATTERN, code):
                raise ValueError(f"Geçersiz sorun kodu: {code}")
            if code not in seen:
                seen.append(code)
        return seen


class DeliveryFeedbackOut(BaseModel):
    id: int
    order_id: int
    thumbs_up: bool
    problem_codes: list[str]
    comment: str | None = None
    source: str
    created_at: datetime.datetime


class DeliveryInfoOut(BaseModel):
    """Public teslimat sözü bilgisi ("şimdi sipariş verirsen ne zaman gelir").
    Ürün/checkout yüzeyindeki rozet sunucu gerçeğinden beslenir — istemci saat
    dilimine/saatine güvenilmez."""

    cutoff_hour: int
    # Şimdi ödenirse söz verilen teslim günü (yerel takvim günü).
    promised_date_now: datetime.date
    # Bugünkü cutoff'a kalan saniye; cutoff geçtiyse None.
    countdown_seconds: int | None = None
    # Cıncık Teslimat bölgesi (bilgi amaçlı; "Adana Merkez'e özel").
    districts: list[str]


class ScanIn(BaseModel):
    payload: str = Field(min_length=1, max_length=200)


class ScanOut(BaseModel):
    stop: DeliveryStopOut
    run_status: str

class DeliveryBoardOut(BaseModel):
    """Gün tahtası (İP-19 §4.2): atanmamış havuz + araç bazlı turlar."""

    unassigned: list[EligibleOrderOut]
    runs: list[DeliveryRunOut]
