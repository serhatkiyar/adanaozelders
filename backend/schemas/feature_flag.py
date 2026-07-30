"""Özellik bayrağı ve ödeme kolu şemaları."""
from __future__ import annotations

import datetime

from pydantic import BaseModel, Field


class FeatureFlagOut(BaseModel):
    """Katalog + DB durumu birleşimi (admin paneli)."""

    key: str
    label: str
    description: str
    enabled: bool
    #: Katalog varsayılanı — operatör "fabrika ayarı neydi" sorusunu sorabilsin.
    default: bool
    #: Kod bu bayrağı fiilen uyguluyor mu? False ise panel "henüz uygulanmıyor"
    #: der; açık görünüp hiçbir şeyi kapatmayan bir kontrol yanıltıcıdır.
    enforced: bool
    updated_at: datetime.datetime | None = None
    updated_by_admin_id: int | None = None
    note: str | None = None


class FeatureFlagUpdate(BaseModel):
    enabled: bool
    #: Neden açıldı/kapatıldı — denetim kaydına ve panele yazılır.
    note: str | None = Field(default=None, max_length=255)


class PaymentBranchOut(BaseModel):
    """Ödeme kolunun durumu. Tek bir global "hazır mı" alanı YOKTUR."""

    branch: str
    label: str
    open: bool
    message: str | None = None
    #: Yalnız admin yüzeyinde döner (public uçlarda çıkarılır).
    flag_enabled: bool | None = None
    blockers: list[str] | None = None


class PaymentAvailabilityOut(BaseModel):
    branches: list[PaymentBranchOut]
