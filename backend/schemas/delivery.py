"""Kendi-filo teslimat (dağıtım turu) request/response şemaları."""
from __future__ import annotations

import datetime

from pydantic import BaseModel, Field


class DeliveryRunCreate(BaseModel):
    run_date: datetime.date
    vehicle: str = Field(default="LADA", pattern="^(LADA|COROLLA)$")
    notes: str | None = Field(default=None, max_length=2000)


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
    otp_sent_at: datetime.datetime | None = None
    delivered_at: datetime.datetime | None = None
    proof: str | None = None
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
    stops: list[DeliveryStopOut] = []


class EligibleOrderOut(BaseModel):
    """Tura eklenebilecek (ödenmiş + fiziksel + açıkta) sipariş özeti."""

    order_id: int
    recipient: str | None = None
    phone: str | None = None
    address: str | None = None
    lat: float | None = None
    lng: float | None = None
    total: str
    item_count: int
    created_at: datetime.datetime


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


class ScanIn(BaseModel):
    payload: str = Field(min_length=1, max_length=200)


class ScanOut(BaseModel):
    stop: DeliveryStopOut
    run_status: str
