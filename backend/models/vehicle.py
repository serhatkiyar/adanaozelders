"""Filo aracı — İP-19'un çekirdek varlığı.

Araç eskiden bir enum'du (`DeliveryVehicle`: LADA/COROLLA) ve o enum **hiçbir
yerde kullanılmıyordu** — kolon serbest string, doğrulama regex, servis ayrı
sözlük, frontend ayrı union taşıyordu (sözleşme §0.1: aynı bilgi 8 kopya).
Üçüncü araç eklemek 6 üretim dosyası + deploy demekti; şimdi bir INSERT.

**`id` doğrudan VROOM vehicle id'sidir** (K-1). Eski `_VEHICLE_IDS = {1:
"LADA", 2: "COROLLA"}` köprüsü bu kararla tamamen ortadan kalktı:
`FleetPlan.routes` anahtarı = `vehicles.id` = VROOM'a giden `id`.

**Vardiya alanları NULLABLE'dır ve bu bir tasarım kararıdır** (K-2): NULL =
"kısıt yok" → VROOM'a `time_window` hiç gönderilmez, plan eski davranışını
birebir korur. Kurucu kendisi taşıyorsa alanlar boş kalır; kurye tutulduğu gün
doldurulur — kod değişmez, deploy olmaz. Operasyonel varsayımlar koda değil
veriye yazılır; "iki araç" hatasının kökeni tam olarak bu ilkenin ihlaliydi.

`fixed_cost` (VROOM `costs.fixed`) yedek aracı çıkarma **ekonomisidir** (K-3):
eski `DELIVERY_SINGLE_VEHICLE_MAX_STOPS=12` eşiği coğrafyayı hiç görmüyordu;
şimdi VROOM ikinci aracı yalnız kazanç sabit maliyeti aşarsa kullanır.

Bilinçli olarak YOKTUR (sözleşme §7): marka/model/yakıt/muayene/sigorta
(varlık yönetimi — 2-5 araçta ajanda işi), çok boyutlu kapasite (kitapta
bağlayıcı kısıt yük değil zamandır, K-4), `is_primary` boolean'ı (üçüncü
araçta anlamsızlaşır — sırayı `sort_order` taşır).
"""
from __future__ import annotations

import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String, Time, text
from sqlalchemy.orm import relationship
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin


class Vehicle(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "vehicles"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: Kısa teknik ad ("LADA"). Geçmiş turların eski string kolonu migration'da
    #: bu alan üzerinden `vehicle_id`'ye eşlendi; benzersizliği o eşleme ister.
    code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    #: Panelde görünen ad ("Lada").
    label: Mapped[str] = mapped_column(String(50), nullable=False)
    #: `couriers.vehicle_plate`'ten taşındı (K-5): plaka araca aittir, sürücüye
    #: değil — kurye araç değiştirince geçmiş yalan söylemesin.
    plate: Mapped[str | None] = mapped_column(String(20), nullable=True)
    #: OSRM profili; motosiklet eklenirse "bike" (bugün hep "car").
    profile: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'car'")
    )
    #: Araç başına durak tavanı. NULL = kısıtsız. Eski global
    #: `DELIVERY_MAX_STOPS_PER_RUN`'ın araç bazlı hâli; günlük tavan artık
    #: aktif araçların bu alanlarının TOPLAMIDIR (sessiz tuzağın kapanışı,
    #: sözleşme §0.2).
    max_stops: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Vardiya penceresi — ikisi de doluysa VROOM `time_window` olur (D-5).
    shift_start: Mapped[datetime.time | None] = mapped_column(Time, nullable=True)
    shift_end: Mapped[datetime.time | None] = mapped_column(Time, nullable=True)
    #: VROOM `costs.fixed`. 0 = maliyet yok (alan payload'a yazılmaz, D-6).
    fixed_cost: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    #: Turun başladığı nokta (K-9). NULL = varsayılan BASE noktası kullanılır.
    start_point_id: Mapped[int | None] = mapped_column(
        ForeignKey("pickup_points.id", ondelete="SET NULL"), nullable=True
    )
    #: "Birincil/yedek" sırası — küçük olan önce önerilir.
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    #: Başlangıç noktası — `lazy="joined"`: araç okunan her yerde tek JOIN ile
    #: gelir; serializer'lar (sync) ekstra sorgu atmadan koordinata ulaşır.
    start_point = relationship("PickupPoint", lazy="joined")
