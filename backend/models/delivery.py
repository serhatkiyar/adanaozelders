"""Mağaza kendi-filo teslimatı (Faz A): günlük dağıtım turu + duraklar.

Fiziksel kitap siparişleri kargo firmasına verilmez; platformun kendi aracı
(LADA birincil, COROLLA yoğunlukta) günlük turlarla dağıtır. Bir tur
(``DeliveryRun``) o günün sıralı duraklarını (``DeliveryStop`` → Order 1:1)
taşır. Teslim kanıtı iki katmandır: paket etiketi QR'ı (doğru paket kontrolü)
+ müşteriye SMS ile giden OTP kodu (kapıda söylenir, sunucu doğrular).
Rota sırası Faz A'da elle belirlenir; Faz B'de VROOM optimizasyonu yazacak.
"""
from __future__ import annotations

import datetime
import enum
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin

if TYPE_CHECKING:
    from models.courier import Courier
    from models.store import Order


class DeliveryRunStatus(str, enum.Enum):
    """Tur FSM'i: PLANNED (kuruluyor) → ACTIVE (sahada) → DONE; iptal CANCELLED."""

    PLANNED = "PLANNED"
    ACTIVE = "ACTIVE"
    DONE = "DONE"
    CANCELLED = "CANCELLED"


class DeliveryStopStatus(str, enum.Enum):
    """FAILED = kurye ulaşamadı (performans metriği); RESCHEDULED = müşteri
    erteledi (kurye suçu değil) — ikisi de siparişi PAID'e geri sarar ama
    müşteri kopyası ve raporlama ayrışır. CANCELLED = sipariş iptal/iade
    edildiği için durak düştü (kurye performansına SAYILMAZ; order_fsm
    CANCELLED/REFUNDED geçişinde otomatik kapatır)."""

    PENDING = "PENDING"
    DELIVERED = "DELIVERED"
    FAILED = "FAILED"
    RESCHEDULED = "RESCHEDULED"
    CANCELLED = "CANCELLED"


class FailReason(str, enum.Enum):
    """Teslim edilememe neden kodu (serbest metnin yerine yapısal — istisna
    kuyruğu [Faz 5] + kurye KPI [Faz 6] için). Müşteriye ASLA sızmaz (timeline
    whitelist yalnız 'teslim edilemedi' gösterir).

    ``counts_against_courier`` False olanlar kurye performansına sayılmaz:
    - ERKEN_DENEME: kurye pencereden önce geldi (E4) — deneme sayılır ama kusur değil
    - GUVENLIK: saha tehdidi (D8) — güvenlik hızdan önce gelir
    - MUSTERI_TALEBI: müşteri kapıda "sonra gel" dedi (kurye kusuru değil)
    Diğerleri (EVDE_YOK/ADRES_SORUNU/ERISIM_SORUNU/PAKET/ARAC/DIGER) sayılır.
    """

    EVDE_YOK = "EVDE_YOK"
    ADRES_SORUNU = "ADRES_SORUNU"
    ERISIM_SORUNU = "ERISIM_SORUNU"  # zil bozuk, siteye giriş yok, kapı açılmadı
    ERKEN_DENEME = "ERKEN_DENEME"
    MUSTERI_TALEBI = "MUSTERI_TALEBI"
    GUVENLIK = "GUVENLIK"
    PAKET_SORUNU = "PAKET_SORUNU"
    ARAC_SORUNU = "ARAC_SORUNU"
    DIGER = "DIGER"


#: Kurye performansına SAYILMAYAN neden kodları (KPI hariç tutma seti).
FAIL_REASONS_NOT_COURIER_FAULT = frozenset(
    {FailReason.ERKEN_DENEME.value, FailReason.GUVENLIK.value, FailReason.MUSTERI_TALEBI.value}
)


class DeliveryProof(str, enum.Enum):
    """Teslim kanıtı türü: müşteri OTP'si, (kod ulaşmadığında) notlu admin onayı
    ya da kapıya/komşuya bırakmada paket fotoğrafı (PoD photo)."""

    OTP = "OTP"
    ADMIN = "ADMIN"
    PHOTO = "PHOTO"


class DeliveryRun(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "delivery_runs"
    __table_args__ = (
        # Gün+araç başına tek PLANLI tur — dispatch-day'in find-or-create'i
        # yarışta iki tur üretmesin (servis kontrolü UX, index otorite).
        # İP-19: anahtar eski serbest `vehicle` string'inden `vehicle_id`
        # FK'sine taşındı; semantik değişmedi (K-8).
        Index(
            "uq_delivery_run_planned",
            "run_date",
            "vehicle_id",
            unique=True,
            postgresql_where=text("status = 'PLANNED' AND deleted_at IS NULL"),
        ),
        # Kurye başına tek AKTİF tur (migration 8590183c3cc1'de eklendi;
        # deklarasyon autogenerate'in index'i "silinmiş" sanmasını önler).
        Index(
            "uq_delivery_run_active_courier",
            "courier_id",
            unique=True,
            postgresql_where=text(
                "courier_id IS NOT NULL AND status = 'ACTIVE' AND deleted_at IS NULL"
            ),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    run_date: Mapped[datetime.date] = mapped_column(Date, nullable=False, index=True)
    # Turun aracı (İP-19). RESTRICT: aktif/geçmiş turu olan araç silinemez —
    # geçmiş turların hangi araçla koşulduğu kaybolmasın (D-8; soft-delete
    # kullanıcı yüzeyindeki yol, FK son savunma hattı).
    vehicle_id: Mapped[int] = mapped_column(
        ForeignKey("vehicles.id", ondelete="RESTRICT"), nullable=False
    )
    #: Adı bilerek `vehicle` DEĞİL: o ad eski serbest-string kolonundu ve
    #: yokluğu matriste ölçülüyor (D-1). `lazy="joined"` — tur okunan her
    #: yerde etiket/plaka/başlangıç tek JOIN ile gelir.
    vehicle_ref = relationship("Vehicle", lazy="joined")
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'PLANNED'")
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Turu süren kurye (müşteri takip sayfasında kimlik kartı olarak gösterilir).
    # Kurye silinirse tur kalır (SET NULL) — geçmiş turlar bozulmaz.
    courier_id: Mapped[int | None] = mapped_column(
        ForeignKey("couriers.id", ondelete="SET NULL"), nullable=True
    )
    started_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ── Rota optimizasyonu (Faz B) — son optimize çıktısının snapshot'ı ──
    optimized_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    optimize_provider: Mapped[str | None] = mapped_column(String(20), nullable=True)
    total_distance_km: Mapped[float | None] = mapped_column(Numeric(7, 1), nullable=True)
    total_duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Encoded polyline5 (yalnız vroom/OSRM); haversine'de None → istemci düz çizer.
    route_geometry: Mapped[str | None] = mapped_column(Text, nullable=True)

    stops: Mapped[list["DeliveryStop"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="DeliveryStop.sequence",
    )
    courier: Mapped["Courier | None"] = relationship()


class DeliveryStop(Base, TimestampMixin):
    """Turun tek durağı — bir fiziksel siparişin teslimi.

    ``qr_token`` paket etiketine basılır (payload ``"{id}:{token}"`` — deneme
    bileti deseniyle aynı). OTP hash'li ve süreli durur; ham kod yalnız SMS'te.
    """

    __tablename__ = "delivery_stops"
    __table_args__ = (
        # Aynı sipariş aynı tura iki kez eklenemez (aktif turlar arası tekillik
        # servis katmanında — FAILED sonrası ertesi günün turuna yeniden eklenebilir).
        UniqueConstraint("run_id", "order_id", name="uq_delivery_stop_run_order"),
        # Bir siparişin aynı anda TEK açık (PENDING) durağı olabilir — turlar
        # arası tekillik. Servisteki _has_open_stop kontrolü UX içindir; yarışta
        # (çift dispatch-day / iki admin) son söz bu index'indir.
        Index(
            "uq_delivery_stop_open",
            "order_id",
            unique=True,
            postgresql_where=text("status = 'PENDING'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(
        ForeignKey("delivery_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    # String(20): "RESCHEDULED" (11 kr) String(10)'a sığmaz.
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'PENDING'")
    )

    qr_token: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )

    # ── Teslim OTP'si (SMS) ──
    otp_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    otp_sent_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    otp_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    # "Kuryen yaklaşıyor" bildirimi damgası — çift SMS engeli (bir kez gider).
    approach_notified_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ── Rota optimizasyonu (Faz B) ──
    eta: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Durağın rotaya kattığı ek yol (km) — eşik üstü "rotayı bozan" işareti.
    detour_km: Mapped[float | None] = mapped_column(Numeric(6, 1), nullable=True)

    # ── Sonuç / kanıt ──
    delivered_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    delivered_lat: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    delivered_lng: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    proof: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # Teslim kanıtı fotoğrafı (kapıya/komşuya bırakma; normal teslimde opsiyonel).
    # Ev kapısı görüntüsü — URL uuid'li, yalnız token/sahip yüzeylerinde gösterilir.
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    courier_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Teslim edilememe neden kodu (FailReason) — FAILED durakta dolu; yapısal
    # raporlama + KPI hariç tutması için. Serbest metin courier_note'ta kalır.
    fail_reason: Mapped[str | None] = mapped_column(String(20), nullable=True)

    run: Mapped["DeliveryRun"] = relationship(back_populates="stops")
    order: Mapped["Order"] = relationship()


class DeliveryClosedDay(Base, TimestampMixin, SoftDeleteMixin):
    """Teslimata kapalı gün — admin yönetir (resmî tatil / özel gün). Söz motoru
    bu günleri atlar (haftalık kural değil, tarih-bazlı; operasyon kendi
    takvimini kontrol eder). ``source`` = 'holiday' (seed'lenen resmî tatil) veya
    'manual' (admin elle ekledi) — ayrım yalnız bilgi/etikettir."""

    __tablename__ = "delivery_closed_days"

    id: Mapped[int] = mapped_column(primary_key=True)
    day: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    source: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'manual'")
    )

    __table_args__ = (
        # Aynı gün iki kez kapatılamaz (silinenler hariç — soft-delete).
        Index(
            "uq_delivery_closed_day",
            "day",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class FeedbackProblem(str, enum.Enum):
    """Teslimat değerlendirmesindeki yapısal sorun kodları (Faz 7). Serbest
    metin yerine kod: KPI Pareto'su üretilebilir, operasyon aksiyon alabilir.
    FailReason'dan AYRIDIR — o kuryenin teslim edememe nedeni, bu müşterinin
    teslim SONRASI deneyim şikâyetidir."""

    GEC_TESLIMAT = "GEC_TESLIMAT"  # söz gününden/penceresinden geç geldi
    HASARLI_PAKET = "HASARLI_PAKET"
    YANLIS_EKSIK_URUN = "YANLIS_EKSIK_URUN"
    KURYE_DAVRANISI = "KURYE_DAVRANISI"
    TESLIM_YERI = "TESLIM_YERI"  # yanlış yere bırakıldı / kapı bulunamadı
    BILDIRIM_SORUNU = "BILDIRIM_SORUNU"  # SMS/kod/bilgilendirme ulaşmadı
    DIGER = "DIGER"


class DeliveryFeedback(Base, TimestampMixin, SoftDeleteMixin):
    """Teslim sonrası müşteri değerlendirmesi: 👍/👎 + yapısal sorun kodları.

    Sipariş başına TEK değerlendirme (partial unique — yarışta son söz index'in).
    Hem oturumlu müşteri hem token'lı public takip sayfasından verilebilir
    (yetki yükseltme değil: durum değiştirmez, yalnız geri bildirim). ``source``
    hangi yüzeyden geldiğini kaydeder (audit/istismar analizi)."""

    __tablename__ = "delivery_feedback"
    __table_args__ = (
        Index(
            "uq_delivery_feedback_order",
            "order_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    thumbs_up: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # FeedbackProblem kodları listesi (JSONB) — 👍'de tipik olarak boş.
    problem_codes: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Geldiği yüzey: CLIENT (oturumlu) | PUBLIC (SMS token'lı takip sayfası).
    source: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'CLIENT'")
    )

    order: Mapped["Order"] = relationship()
