"""Başlangıç/toplama noktaları — depo YOKTUR (K-9).

Config'teki eski `DELIVERY_DEPOT_LAT/LNG` koordinatı gerçek bir yer değildi
(şehir merkezi yer tutucusu) ve **iki alakasız işi birden** taşıyordu: rotanın
başlangıcı + teslimat bölgesinin merkezi (K-10'daki tasarım hatası). Bölge
kararı ilçe listesine taşındı; başlangıç noktası bu tabloya.

İki tür kayıt:

* ``BASE``     — turun başladığı yer (konsolidasyon noktası: ev, dükkân, araç).
* ``SUPPLIER`` — toptancı. **Bu pakette rotaya GİRMEZ** (K-11: tur tek fazlı,
  toplama bacağı planlanmaz — esneklik algoritmaya değil sürücüye bırakıldı).
  Veride durur ki ileride VROOM `shipments` akışı açılırsa hazır olsun;
  ertelemek bedava olsun diye şimdi kaydediliyor.
"""
from __future__ import annotations

from sqlalchemy import Boolean, Float, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin


class PickupPoint(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "pickup_points"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    #: BASE | SUPPLIER — CHECK yerine uygulama doğrular (şema regex'i,
    #: `schemas/delivery.py`); yeni tür eklemek migration istemesin.
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
