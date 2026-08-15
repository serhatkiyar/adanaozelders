"""Kurye profili (Cıncık Teslimat dağıtıcısı).

Kullanıcı hesabı DEĞİLDİR — saha ekranı ADMIN yetkisiyle açılır; bu tablo yalnız
müşteriye gösterilen kimliği (isim + vesikalık foto + araç plakası) ve tur
atamasını taşır. Admin panelden yönetilir (hafif CRUD)."""
from __future__ import annotations

from sqlalchemy import Boolean, String, text
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin


class Courier(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "couriers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # İP-19 (K-5): `vehicle_plate` KALDIRILDI — plaka araca aittir
    # (`vehicles.plate`), sürücüye değil. Kurye araç değiştirince müşteri
    # takip sayfası yanlış plaka gösteriyordu; plaka artık turun aracından okunur.
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
