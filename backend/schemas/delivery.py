"""Kendi-filo teslimat (dağıtım turu) request/response şemaları."""
from __future__ import annotations

import datetime

from pydantic import BaseModel, Field


class DeliveryRunCreate(BaseModel):
    run_date: datetime.date
    vehicle: str = Field(default="LADA", pattern="^(LADA|COROLLA)$")
    notes: str | None = Field(default=None, max_length=2000)
    courier_id: int | None = None


class DeliveryRunUpdate(BaseModel):
    """Tur meta güncellemesi (şimdilik yalnız kurye ataması)."""

    courier_id: int | None = None


# ── Kurye profili ─────────────────────────────────────────────────────────────────


class CourierCreate(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    phone: str | None = Field(default=None, max_length=30)
    vehicle_plate: str | None = Field(default=None, max_length=20)


class CourierUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=150)
    phone: str | None = Field(default=None, max_length=30)
    vehicle_plate: str | None = Field(default=None, max_length=20)
    is_active: bool | None = None


class CourierOut(BaseModel):
    id: int
    name: str
    phone: str | None = None
    photo_url: str | None = None
    vehicle_plate: str | None = None
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


class DeliveryRunOut(BaseModel):
    id: int
    run_date: datetime.date
    vehicle: str
    status: str
    notes: str | None = None
    started_at: datetime.datetime | None = None
    completed_at: datetime.datetime | None = None
    created_at: datetime.datetime
    # Depo = turun başlangıç noktası (navigasyon ilk ayağı için).
    depot_lat: float
    depot_lng: float
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
    created_at: datetime.datetime
    # Söz verilen teslim günü (16:00 cutoff kuralı) — eski siparişlerde None.
    promised_delivery_date: datetime.date | None = None
    # True=Cıncık bölgesi, False=bölge dışı, None=belirlenemedi.
    in_zone: bool | None = None


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


class OrderTrackingOut(BaseModel):
    """Müşterinin sipariş takibi: kurye nerede, kaç durak önde, tahmini varış.

    status: NOT_DISPATCHED (bugünkü tura çıkmadı) | EN_ROUTE (dağıtımda) |
    DELIVERED | FAILED (bugün teslim edilemedi, yeniden planlanacak).
    """

    status: str
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
    promised_delivery_date: datetime.date | None = None
    courier_name: str | None = None
    courier_photo_url: str | None = None
    courier_plate: str | None = None
    # Olay akışı (ORDER_RECEIVED → … → DELIVERED; Türkçe metin frontend'de).
    timeline: list[TimelineEventOut] = []
    # Teslim kanıtı (yalnız DELIVERED'da): saat + kanıt türü (OTP/ADMIN/PHOTO).
    delivered_at: datetime.datetime | None = None
    proof: str | None = None
    proof_photo_url: str | None = None


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
