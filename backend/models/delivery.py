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
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin

if TYPE_CHECKING:
    from models.courier import Courier
    from models.store import Order


class DeliveryVehicle(str, enum.Enum):
    """Filo araçları. LADA birincil; COROLLA yalnız yoğun günlerde."""

    LADA = "LADA"
    COROLLA = "COROLLA"


class DeliveryRunStatus(str, enum.Enum):
    """Tur FSM'i: PLANNED (kuruluyor) → ACTIVE (sahada) → DONE; iptal CANCELLED."""

    PLANNED = "PLANNED"
    ACTIVE = "ACTIVE"
    DONE = "DONE"
    CANCELLED = "CANCELLED"


class DeliveryStopStatus(str, enum.Enum):
    """FAILED = kurye ulaşamadı (performans metriği); RESCHEDULED = müşteri
    erteledi (kurye suçu değil) — ikisi de siparişi PAID'e geri sarar ama
    müşteri kopyası ve raporlama ayrışır."""

    PENDING = "PENDING"
    DELIVERED = "DELIVERED"
    FAILED = "FAILED"
    RESCHEDULED = "RESCHEDULED"


class DeliveryProof(str, enum.Enum):
    """Teslim kanıtı türü: müşteri OTP'si, (kod ulaşmadığında) notlu admin onayı
    ya da kapıya/komşuya bırakmada paket fotoğrafı (PoD photo)."""

    OTP = "OTP"
    ADMIN = "ADMIN"
    PHOTO = "PHOTO"


class DeliveryRun(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "delivery_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_date: Mapped[datetime.date] = mapped_column(Date, nullable=False, index=True)
    vehicle: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'LADA'")
    )
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

    run: Mapped["DeliveryRun"] = relationship(back_populates="stops")
    order: Mapped["Order"] = relationship()
